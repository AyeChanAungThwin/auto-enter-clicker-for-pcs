#!/usr/bin/env python3
"""
Enter Key Clicker — local helper bridge.

Lets the Enter Key Clicker web page start/stop REAL Enter presses on this Mac.
The browser itself can never send keystrokes to other apps; this helper runs
outside the browser and does it, using the same CoreGraphics HID-level
injection as the generated Terminal command.

Run:            python3 bridge.py
                (keep the window open — Ctrl+C or close the window to stop)
Auto-start:     run ./start-bridge.command (add it to Login Items for auto-start)

Endpoints:
  GET  /ping    -> {"ok":true,"running":bool,"presses":int,"interval":int,"count":int}
  GET  /pick    -> {"ok":true,"x":float,"y":float} — current global cursor position
  POST /aim     {"timeout": 1-60} -> full-screen aim overlay; {"ok":true,"x":int,"y":int}
                 on click, {"ok":false,"reason":"cancelled"} on Esc/timeout,
                 {"ok":false,"reason":"unavailable"} when no GUI is possible
  POST /start   {"interval": 10-9999, "count": 0 (infinite) | 1-9999,
                 "click": 0|1, "tab": 0|1,
                 "clickList": [[x, y], ...] (0-20 entries, each 0-99999)
                 — each interval fires the whole list 0.2s apart}
  POST /stop    -> stops any running press loop
"""
import json
import os
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

# Same loop as the "Copy Terminal command" feature: keydown + 20 ms hold +
# keyup, posted at the HID event tap from an HID-system event source.
# Each interval fires the WHOLE target list as a burst, one entry every 0.2s
# (each step: Click(x, y) -> Tab (optional) -> Enter), then waits so the next
# burst starts one interval after the previous one.
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
  for (var j = 0; j < steps; j++) {
    if (N !== 0 && done >= N) break;
    press(TARGETS.length > 0 ? j : 0);
    done += 1;
    if (j < steps - 1) $.NSThread.sleepForTimeInterval(0.2);
  }
  if (N !== 0 && done >= N) break;
  var gap = I - (steps - 1) * 0.2;
  $.NSThread.sleepForTimeInterval(gap > 0.05 ? gap : 0.05);
}
"done\""""

# Reads the current global cursor position (no accessibility permission
# needed — CGEventGetLocation is read-only). Used by the web page's
# "Pick" button so the click target can be aimed with the real cursor.
JXA_PICK = """ObjC.import("CoreGraphics");
var loc = $.CGEventGetLocation($.CGEventCreate($()));
JSON.stringify({x: loc.x, y: loc.y});"""


class Bridge:
    def __init__(self):
        self.proc = None
        self.interval = 0
        self.count = 0
        self.step_count = 1
        self.started_at = 0.0
        # RLock: start()/stop() report their result via status() while still
        # holding the lock — a plain Lock would deadlock there.
        self.lock = threading.RLock()

    def status(self):
        with self.lock:
            running = self.proc is not None and self.proc.poll() is None
            presses = 0
            if running and self.interval > 0:
                # Burst mode: each interval fires step_count presses 0.2s
                # apart, then waits out the rest of the interval.
                period = max(self.interval, self.step_count * 0.2)
                elapsed = time.time() - self.started_at
                cycles = elapsed // period
                cycle_elapsed = elapsed - cycles * period
                done = int(cycles) * self.step_count
                done += min(self.step_count, 1 + int(cycle_elapsed // 0.2))
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
            script = (
                JXA_TEMPLATE
                .replace("__N__", str(count))
                .replace("__I__", str(interval))
                .replace("__CE__", str(click))
                .replace("__CT__", str(tab))
                .replace("__TARGETS__", json.dumps(targets))
            )
            self.interval = interval
            self.count = count
            self.step_count = len(targets) if click and targets else 1
            self.started_at = time.time()
            self.proc = subprocess.Popen(
                ["osascript", "-l", "JavaScript", "-e", script],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
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
            self._json(200, bridge.status())
        elif self.path.startswith("/pick"):
            try:
                proc = subprocess.run(
                    ["osascript", "-l", "JavaScript", "-e", JXA_PICK],
                    capture_output=True,
                    text=True,
                    timeout=3,
                )
                point = json.loads(proc.stdout.strip() or "{}")
                x = float(point.get("x", -1))
                y = float(point.get("y", -1))
            except (OSError, ValueError, json.JSONDecodeError, subprocess.SubprocessError):
                self._json(500, {"ok": False, "error": "could not read the cursor position"})
                return
            if x < 0 or y < 0:
                self._json(500, {"ok": False, "error": "could not read the cursor position"})
                return
            self._json(200, {"ok": True, "x": x, "y": y})
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
        self._json(200, bridge.start(interval, count, click, tab, targets))

    def log_message(self, *args):  # keep the helper window quiet
        pass


if __name__ == "__main__":
    if "--aim-overlay" in sys.argv:
        flag = sys.argv.index("--aim-overlay")
        timeout = int(sys.argv[flag + 1]) if len(sys.argv) > flag + 1 else 15
        run_aim_overlay(timeout)
        raise SystemExit(0)
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"Bridge already running (port {PORT} busy) — open the web app and press Start.")
        raise SystemExit(0)
    print(f"Enter Key Clicker bridge listening on http://{HOST}:{PORT}")
    print("Open the web app and press Start — presses will land in the frontmost app.")
    print("Stop this helper with Ctrl+C (or just close this window).")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        bridge.stop()
        print("\nBridge stopped.")
