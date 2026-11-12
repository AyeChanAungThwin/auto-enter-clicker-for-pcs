#!/usr/bin/env python3
"""
Enter Key Clicker — local helper bridge.

Lets the Enter Key Clicker web page start/stop REAL Enter presses on this PC.
The browser itself can never send keystrokes to other apps; this helper runs
outside the browser and does it, with the same injection the generated
platform scripts use:
  macOS   — osascript + CoreGraphics HID-level event posting
  Windows — ctypes: SetCursorPos / mouse_event / keybd_event (no permission needed)
  Linux   — xdotool (X11; on Wayland run through the input-group ydotool setup)

Run:            python3 bridge.py
                (keep the window open — Ctrl+C or close the window to stop)
Auto-start:     macOS ./start-bridge.command — Windows double-click start-bridge.bat
Launcher:       every run (re)registers the enterclickerbridge:// URL scheme,
                so the web page can start this helper itself — the "Start
                bridge" button / its on-load attempt — after it went offline.

Endpoints:
  GET  /ping    -> {"ok":true,"running":bool,"presses":int,"interval":int,"count":int}
  GET  /pick    -> {"ok":true,"x":float,"y":float} — current global cursor position
  POST /aim     {"timeout": 1-60} -> full-screen aim overlay; {"ok":true,"x":int,"y":int}
                 on click, {"ok":false,"reason":"cancelled"} on Esc/timeout,
                 {"ok":false,"reason":"unavailable"} when no GUI is possible
  POST /start   {"interval": 10-9999, "count": 0 (infinite) | 1-9999,
                 "click": 0|1, "tab": 0|1,
                 "clickList": [[x, y], ...] (0-20 entries, each 0-99999)
                 — each cycle fires the whole list 0.2s apart; the cycle
                 between bursts is interval + 0.2s × entries}
  POST /stop    -> stops any running press loop
  POST /shutdown-> stops the press loop and exits the helper process
"""
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8791
INTERVAL_MIN, INTERVAL_MAX = 10, 9999
COUNT_MAX = 9999
XY_MAX = 99999
MAX_TARGETS = 20
AIM_TIMEOUT_MAX = 60
STEP_DELAY = 0.2      # seconds between the entries inside one burst
XDOTOOL_MISSING = "xdotool is required on Linux (X11): sudo apt install xdotool"

# macOS loop — same as the "Copy Terminal command" feature: keydown +
# 20 ms hold + keyup, posted at the HID event tap from an HID-system event
# source. Each cycle WAITS the interval first, then fires the WHOLE target
# list as a burst, one entry every 0.2s (each step: Click(x, y) -> Tab
# (optional) -> Enter) at the tail of the cycle. Cycle length =
# I + 0.2s per entry, so presses land interval seconds after every mark.
# __N__ = presses (0 = run forever), __I__ = seconds between bursts,
# __CE__ = click enabled (0/1), __CT__ = Tab enabled (0/1),
# __TARGETS__ = JSON array literal like [[100, 200], [3, 4]].
JXA_TEMPLATE = """ObjC.import("CoreGraphics");
ObjC.import("Foundation");
var N = __N__, I = __I__;
var CLICK = __CE__, TAB = __CT__;
var TARGETS = __TARGETS__;
var src = $.CGEventSourceCreate(1);
function clickXY(x, y) {
  var mv = $.CGEventCreateMouseEvent(src, 5, {x: x, y: y}, 0);
  $.CGEventPost(0, mv);
  $.NSThread.sleepForTimeInterval(0.02);
  var d = $.CGEventCreateMouseEvent(src, 1, {x: x, y: y}, 0);
  $.CGEventPost(0, d);
  $.NSThread.sleepForTimeInterval(0.02);
  var u = $.CGEventCreateMouseEvent(src, 2, {x: x, y: y}, 0);
  $.CGEventPost(0, u);
  $.NSThread.sleepForTimeInterval(0.05);
}
function keyTap(code) {
  var d = $.CGEventCreateKeyboardEvent(src, code, true);
  $.CGEventPost(0, d);
  $.NSThread.sleepForTimeInterval(0.02);
  var u = $.CGEventCreateKeyboardEvent(src, code, false);
  $.CGEventPost(0, u);
}
function press(idx) {
  var p = TARGETS[idx % TARGETS.length];
  if (CLICK === 1 && TARGETS.length > 0) clickXY(p[0], p[1]);
  if (TAB === 1) keyTap(48); // Tab (keyCode 48)
  keyTap(36); // Enter / Return (keyCode 13)
}
var steps = TARGETS.length > 0 ? TARGETS.length : 1;
var done = 0;
while (N === 0 || done < N) {
  $.NSThread.sleepForTimeInterval(I);
  for (var j = 0; j < steps; j++) {
    if (N !== 0 && done >= N) break;
    press(TARGETS.length > 0 ? j : 0);
    done += 1;
    if (j < steps - 1) $.NSThread.sleepForTimeInterval(0.2);
  }
}
"done\""""

# Reads the current global cursor position (no accessibility permission
# needed — CGEventGetLocation is read-only). Used by the web page's
# "Pick" button so the click target can be aimed with the real cursor.
JXA_PICK = """ObjC.import("CoreGraphics");
var loc = $.CGEventGetLocation($.CGEventCreate($()));
JSON.stringify({x: loc.x, y: loc.y});"""


# ---------------------------------------------------------------------------
# Native (non-macOS) press loop — runs as `bridge.py --press-loop <json>`.
# Identical timing to the macOS JXA loop: burst of the whole target list with
# STEP_DELAY between entries, gap sleep of I + 0.2s × entries after it.
# ---------------------------------------------------------------------------

def _win_injectors():
    """Windows: user32 via ctypes — no admin rights or permission needed."""
    import ctypes
    user32 = ctypes.windll.user32
    VK_TAB, VK_RETURN = 0x09, 0x0D
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x0002, 0x0004

    def click(x, y):
        user32.SetCursorPos(int(x), int(y))
        time.sleep(0.02)
        user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
        time.sleep(0.02)
        user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
        time.sleep(0.05)

    def key_tap(vk):
        user32.keybd_event(vk, 0, 0, 0)
        time.sleep(0.02)
        user32.keybd_event(vk, 0, 0x0002, 0)  # KEYEVENTF_KEYUP

    return click, key_tap, lambda: (VK_TAB, VK_RETURN)


def _xdotool_injectors():
    """Linux (X11): xdotool subprocess calls."""

    def click(x, y):
        subprocess.run(["xdotool", "mousemove", str(int(x)), str(int(y)), "click", "1"], check=True)
        time.sleep(0.05)

    def key_tap(name):
        subprocess.run(["xdotool", "key", name], check=True)
        time.sleep(0.02)

    return click, key_tap, lambda: ("Tab", "Return")


class NativePressLoop:
    """Runs the burst loop in-process (the subprocess side of --press-loop)."""

    def __init__(self, payload):
        self.click_enabled = bool(payload["click"])
        self.tab_enabled = bool(payload["tab"])
        self.targets = payload["targets"]
        self.interval = float(payload["interval"])
        self.count = int(payload["count"])

    def run(self):
        if sys.platform == "win32":
            click, key_tap, key_names = _win_injectors()
        else:
            click, key_tap, key_names = _xdotool_injectors()
        tab_vk, enter_key = key_names()

        steps = len(self.targets) if self.targets else 1
        done = 0
        while self.count == 0 or done < self.count:
            for j in range(steps):
                if self.count != 0 and done >= self.count:
                    break
                if self.targets and self.click_enabled:
                    x, y = self.targets[j % len(self.targets)]
                    click(x, y)
                if self.tab_enabled:
                    key_tap(tab_vk)
                key_tap(enter_key)
                done += 1
                if j < steps - 1:
                    time.sleep(STEP_DELAY)
            if self.count != 0 and done >= self.count:
                break
            time.sleep(self.interval + (0.2 if self.targets else 0))


def run_press_loop(payload):
    try:
        NativePressLoop(payload).run()
    except (OSError, KeyError, ValueError):  # xdotool gone / bad payload
        pass


def cursor_position():
    """Current global cursor position, or None if it cannot be read."""
    if sys.platform == "darwin":
        proc = subprocess.run(
            ["osascript", "-l", "JavaScript", "-e", JXA_PICK],
            capture_output=True, text=True, timeout=3,
        )
        try:
            point = json.loads(proc.stdout.strip() or "{}")
            x, y = float(point.get("x", -1)), float(point.get("y", -1))
        except (ValueError, json.JSONDecodeError):
            return None
        return None if x < 0 or y < 0 else (x, y)

    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        pt = wintypes.POINT()
        if not ctypes.windll.user32.GetCursorPos(ctypes.byref(pt)):
            return None
        return float(pt.x), float(pt.y)

    if shutil.which("xdotool") is None:
        return None
    proc = subprocess.run(["xdotool", "getmouselocation"], capture_output=True, text=True, timeout=3)
    match = re.search(r"x:(\d+) y:(\d+)", proc.stdout)
    if not match:
        return None
    return float(match.group(1)), float(match.group(2))


def press_loop_platform_ok():
    """Raise nothing — returns an error message or None before /start spawns."""
    if sys.platform == "linux" and shutil.which("xdotool") is None:
        return XDOTOOL_MISSING
    return None


class Bridge:
    def __init__(self):
        self.proc = None
        self.interval = 0
        self.count = 0
        self.step_count = 1
        self.period = 0
        self.started_at = 0.0
        # RLock: start()/stop() report their result via status() while still
        # holding the lock — a plain Lock would deadlock there.
        self.lock = threading.RLock()

    def status(self):
        with self.lock:
            running = self.proc is not None and self.proc.poll() is None
            presses = 0
            if running and self.period > 0:
                # Burst mode: each cycle WAITS the interval first, then fires
                # step_count presses 0.2s apart at the tail, so the next burst
                # lands one full period later (period = interval + 0.2s/entry).
                elapsed = time.time() - self.started_at
                cycles = int(elapsed // self.period)
                cycle_elapsed = elapsed - cycles * self.period
                done = cycles * self.step_count
                if cycle_elapsed >= self.interval:
                    within = cycle_elapsed - self.interval
                    done += min(self.step_count, 1 + int(within // 0.2))
                presses = int(done)
                if self.count > 0:
                    presses = min(presses, self.count)
            return {
                "ok": True,
                "running": running,
                "interval": self.interval,
                "count": self.count,
                "presses": presses,
            }

    def start(self, interval, count, click, tab, targets):
        with self.lock:
            self._stop_locked()
            if sys.platform == "darwin":
                script = (
                    JXA_TEMPLATE
                    .replace("__N__", str(count))
                    .replace("__I__", str(interval))
                    .replace("__CE__", str(click))
                    .replace("__CT__", str(tab))
                    .replace("__TARGETS__", json.dumps(targets))
                )
                argv = ["osascript", "-l", "JavaScript", "-e", script]
            else:
                payload = json.dumps({
                    "interval": interval,
                    "count": count,
                    "click": click,
                    "tab": tab,
                    "targets": targets,
                })
                argv = [sys.executable, os.path.abspath(__file__), "--press-loop", payload]
            self.interval = interval
            self.count = count
            self.step_count = len(targets) if targets else 1
            self.period = interval + (len(targets) * 0.2 if targets else 0)
            self.started_at = time.time()
            kwargs = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
            if sys.platform != "win32":
                # POSIX-only: detaches the helper from this server's process
                # group. On Windows this kwarg raises ValueError.
                kwargs["start_new_session"] = True
            self.proc = subprocess.Popen(argv, **kwargs)
            return self.status()

    def stop(self):
        with self.lock:
            self._stop_locked()
            return self.status()

    def _stop_locked(self):
        if self.proc is not None:
            if self.proc.poll() is None:
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
                    try:
                        self.proc.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        pass
            self.proc = None


bridge = Bridge()


class AimOverlay:
    """Full-screen aim overlay: a semi-transparent topmost window with a
    crosshair that follows the cursor across the ENTIRE screen. A left-click
    anywhere sets the click target — much more precise than clicking inside
    the browser page. Esc cancels; it also self-cancels after the timeout.

    tkinter needs its main thread on macOS, but bridge.py's main thread runs
    the HTTP server — so the overlay runs as a short-lived subprocess whose
    only job is the Tk mainloop, keeping crashes isolated too."""

    def __init__(self):
        # One overlay at a time.
        self.lock = threading.Lock()

    def pick(self, timeout):
        with self.lock:
            try:
                proc = subprocess.run(
                    [sys.executable, os.path.abspath(__file__), "--aim-overlay", str(timeout)],
                    capture_output=True,
                    text=True,
                    timeout=timeout + 5,
                )
            except (OSError, subprocess.SubprocessError):
                return {"picked": False, "unavailable": True}
            line = proc.stdout.strip() or ""
            if line.startswith("PICK "):
                _, x, y = line.split()
                return {"picked": True, "x": int(x), "y": int(y)}
            if line == "UNAVAILABLE":
                return {"picked": False, "unavailable": True}
            # "CANCELLED" (Esc or timeout) or empty output.
            return {"picked": False, "unavailable": False}


def run_aim_overlay(timeout):
    """The subprocess side: shows the overlay on this (main) thread and
    prints PICK x y / CANCELLED / UNAVAILABLE to stdout."""
    try:
        import tkinter as tk
    except ImportError:
        print("UNAVAILABLE")
        return
    try:
        root = tk.Tk()
    except tk.TclError:
        print("UNAVAILABLE")
        return

    box = {"picked": False}

    def finish():
        try:
            root.destroy()
        except tk.TclError:
            pass

    sw, sh = root.winfo_screenwidth(), root.winfo_screenheight()
    root.geometry(f"{sw}x{sh}+0+0")
    try:
        root.attributes("-fullscreen", True)
        root.attributes("-topmost", True)
        root.attributes("-alpha", 0.15)
    except tk.TclError:
        pass
    root.overrideredirect(True)
    root.configure(cursor="crosshair")
    canvas = tk.Canvas(root, bg="#07070d", highlightthickness=0)
    canvas.pack(fill="both", expand=True)
    hint = canvas.create_text(
        sw // 2, sh // 2,
        text="Click anywhere on the screen to set the click target\n(Esc cancels)",
        fill="#a5b4fc", font=("Helvetica", 24, "bold"), justify="center",
    )

    def draw_cross(e):
        canvas.delete("cross")
        r = 16
        canvas.create_line(0, e.y, sw, e.y, fill="#818cf8", width=2, tags="cross")
        canvas.create_line(e.x, 0, e.x, sh, fill="#818cf8", width=2, tags="cross")
        canvas.create_oval(e.x - r, e.y - r, e.x + r, e.y + r, outline="#818cf8", width=2, tags="cross")
        canvas.tag_raise(hint)

    def on_click(e):
        box["picked"] = True
        print(f"PICK {int(e.x_root)} {int(e.y_root)}", flush=True)
        finish()

    def on_key(e):
        finish()

    def on_timeout():
        finish()

    canvas.bind("<Motion>", draw_cross)
    canvas.bind("<Button-1>", on_click)
    root.bind("<Escape>", on_key)
    root.after(int(timeout * 1000), on_timeout)
    root.mainloop()
    if not box["picked"]:
        print("CANCELLED", flush=True)


aim_overlay = AimOverlay()


# ---------------------------------------------------------------------------
# One-click launcher registration (WINDOWS ONLY) — each time bridge.py runs
# it registers the enterclickerbridge:// URL protocol handler in HKCU, so the
# web app's "Start bridge" button (and its automatic attempt on page load)
# can relaunch the helper later. The launch runs pythonw bridge.py: no
# console window at all — the page's badge turning green is the confirmation.
# Other platforms: no registration — the bridge is started manually there
# (start-bridge.command / python3 bridge.py).
# ---------------------------------------------------------------------------

BRIDGE_URL_SCHEME = "enterclickerbridge"


def _windows_silent_launcher():
    launcher = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    return launcher if os.path.exists(launcher) else sys.executable


def _register_launcher_windows():
    import winreg
    key_path = r"Software\Classes\%s" % BRIDGE_URL_SCHEME
    command = '"%s" "%s" "%%1"' % (
        _windows_silent_launcher(),
        os.path.abspath(__file__),
    )
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, "URL:Enter Key Clicker Bridge")
        winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path + r"\shell\open\command") as key:
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, command)


def register_launcher():
    # Windows-only per design: macOS (and Linux) start the bridge manually.
    if sys.platform != "win32":
        return
    try:
        _register_launcher_windows()
    except OSError:
        pass


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Required when the page is served over https (GitHub Pages) and calls
        # this http://127.0.0.1 helper — Chrome's Private Network Access check.
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _json(self, code, obj):
        payload = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/ping"):
            status = bridge.status()
            self._json(200, status)
        elif self.path.startswith("/pick"):
            try:
                point = cursor_position()
            except (OSError, ValueError, subprocess.SubprocessError):
                point = None
            if point is None:
                error = XDOTOOL_MISSING if sys.platform == "linux" else "could not read the cursor position"
                self._json(500, {"ok": False, "error": error})
                return
            self._json(200, {"ok": True, "x": point[0], "y": point[1]})
        else:
            self._json(404, {"ok": False})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        body = {}
        if length:
            try:
                body = json.loads(self.rfile.read(length))
            except ValueError:
                self._json(400, {"ok": False, "error": "invalid JSON"})
                return

        if self.path.startswith("/aim"):
            try:
                timeout = int(body.get("timeout", 15))
            except (TypeError, ValueError):
                self._json(400, {"ok": False, "error": "timeout must be an integer"})
                return
            if not (1 <= timeout <= AIM_TIMEOUT_MAX):
                self._json(400, {"ok": False, "error": "timeout out of range"})
                return
            result = aim_overlay.pick(timeout)
            if result["picked"]:
                self._json(200, {"ok": True, "x": result["x"], "y": result["y"]})
            elif result["unavailable"]:
                self._json(200, {"ok": False, "reason": "unavailable"})
            else:
                self._json(200, {"ok": False, "reason": "cancelled"})
        elif self.path.startswith("/start"):
            self._start_from(body)
        elif self.path.startswith("/stop"):
            self._json(200, bridge.stop())
        elif self.path.startswith("/shutdown"):
            self._json(200, {"ok": True, "stopping": True})
            # serve_forever runs on the main thread; this handler thread only
            # sets it in motion, then __main__ cleans the press loop up.
            threading.Thread(target=self.server.shutdown, daemon=True).start()
        else:
            self._json(404, {"ok": False})

    def _start_from(self, body):
        try:
            interval = int(body.get("interval", 0))
            count = int(body.get("count", 0))
            click = int(body.get("click", 0))
            tab = int(body.get("tab", 0))
        except (TypeError, ValueError):
            self._json(400, {"ok": False, "error": "parameters must be integers"})
            return

        # Target list: fired as a burst each interval, 0.2s between entries.
        # Falls back to the legacy single clickX/clickY pair when clickList
        # is not supplied.
        raw_list = body.get("clickList")
        if raw_list is None:
            try:
                legacy_x = int(body.get("clickX", 0))
                legacy_y = int(body.get("clickY", 0))
            except (TypeError, ValueError):
                self._json(400, {"ok": False, "error": "parameters must be integers"})
                return
            raw_list = [[legacy_x, legacy_y]]
        if not isinstance(raw_list, list) or len(raw_list) > MAX_TARGETS:
            self._json(400, {"ok": False, "error": "clickList must hold 0-%d [x, y] entries" % MAX_TARGETS})
            return
        targets = []
        for entry in raw_list:
            if not isinstance(entry, (list, tuple)) or len(entry) != 2:
                self._json(400, {"ok": False, "error": "clickList entries must be [x, y] pairs"})
                return
            try:
                x, y = int(entry[0]), int(entry[1])
            except (TypeError, ValueError):
                self._json(400, {"ok": False, "error": "click coordinates must be integers"})
                return
            if not (0 <= x <= XY_MAX and 0 <= y <= XY_MAX):
                self._json(400, {"ok": False, "error": "click coordinates out of range"})
                return
            targets.append([x, y])

        if not (INTERVAL_MIN <= interval <= INTERVAL_MAX):
            self._json(400, {"ok": False, "error": "interval out of range"})
            return
        if not (0 <= count <= COUNT_MAX):
            self._json(400, {"ok": False, "error": "count out of range"})
            return
        if click not in (0, 1):
            self._json(400, {"ok": False, "error": "click must be 0 or 1"})
            return
        if tab not in (0, 1):
            self._json(400, {"ok": False, "error": "tab must be 0 or 1"})
            return
        platform_error = press_loop_platform_ok()
        if platform_error:
            self._json(500, {"ok": False, "error": platform_error})
            return
        self._json(200, bridge.start(interval, count, click, tab, targets))

    def log_message(self, *args):  # keep the helper window quiet
        pass


if __name__ == "__main__":
    if "--aim-overlay" in sys.argv:
        flag = sys.argv.index("--aim-overlay")
        timeout = int(sys.argv[flag + 1]) if len(sys.argv) > flag + 1 else 15
        run_aim_overlay(timeout)
        raise SystemExit(0)
    if "--press-loop" in sys.argv:
        flag = sys.argv.index("--press-loop")
        payload = json.loads(sys.argv[flag + 1]) if len(sys.argv) > flag + 1 else {}
        run_press_loop(payload)
        raise SystemExit(0)
    try:
        class BridgeServer(ThreadingHTTPServer):
            # HTTPServer sets allow_reuse_address=True (SO_REUSEADDR); on
            # Windows that lets several instances bind 8791 simultaneously,
            # so /shutdown would only stop whichever one the OS routes to.
            allow_reuse_address = False
        server = BridgeServer((HOST, PORT), Handler)
    except OSError:
        print(f"Bridge already running (port {PORT} busy) — open the web app and press Start.")
        raise SystemExit(0)
    print(f"Enter Key Clicker bridge listening on http://{HOST}:{PORT}")
    print("Open the web app and press Start — presses will land in the frontmost app.")
    print("Stop this helper with Ctrl+C (or just close this window).")
    register_launcher()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        bridge.stop()
        print("\nBridge stopped.")
