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
  POST /start   {"interval": 1-9999, "count": 0 (infinite) | 1-9999}
  POST /stop    -> stops any running press loop
"""
import json
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = 8791
INTERVAL_MIN, INTERVAL_MAX = 1, 9999
COUNT_MAX = 9999

# Same loop as the "Copy Terminal command" feature: keydown + 20 ms hold +
# keyup, posted at the HID event tap from an HID-system event source.
# __N__ = presses (0 = run forever), __I__ = seconds between presses.
JXA_TEMPLATE = """ObjC.import("CoreGraphics");
ObjC.import("Foundation");
var N = __N__, I = __I__;
var src = $.CGEventSourceCreate(1);
function press() {
  var d = $.CGEventCreateKeyboardEvent(src, 36, true);
  $.CGEventPost(0, d);
  $.NSThread.sleepForTimeInterval(0.02);
  var u = $.CGEventCreateKeyboardEvent(src, 36, false);
  $.CGEventPost(0, u);
}
var i = 0;
while (N === 0 || i < N) {
  press();
  i += 1;
  if (N === 0 || i < N) $.NSThread.sleepForTimeInterval(I);
}
"done\""""


class Bridge:
    def __init__(self):
        self.proc = None
        self.interval = 0
        self.count = 0
        self.started_at = 0.0
        # RLock: start()/stop() report their result via status() while still
        # holding the lock — a plain Lock would deadlock there.
        self.lock = threading.RLock()

    def status(self):
        with self.lock:
            running = self.proc is not None and self.proc.poll() is None
            presses = 0
            if running and self.interval > 0:
                # First press fires immediately at t=0, then one per interval.
                elapsed = time.time() - self.started_at
                presses = 1 + int(elapsed // self.interval)
                if self.count > 0:
                    presses = min(presses, self.count)
            return {
                "ok": True,
                "running": running,
                "interval": self.interval,
                "count": self.count,
                "presses": presses,
            }

    def start(self, interval, count):
        with self.lock:
            self._stop_locked()
            script = JXA_TEMPLATE.replace("__N__", str(count)).replace("__I__", str(interval))
            self.interval = interval
            self.count = count
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


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

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

        if self.path.startswith("/start"):
            try:
                interval = int(body.get("interval", 0))
                count = int(body.get("count", 0))
            except (TypeError, ValueError):
                self._json(400, {"ok": False, "error": "interval/count must be integers"})
                return
            if not (INTERVAL_MIN <= interval <= INTERVAL_MAX):
                self._json(400, {"ok": False, "error": "interval out of range"})
                return
            if not (0 <= count <= COUNT_MAX):
                self._json(400, {"ok": False, "error": "count out of range"})
                return
            self._json(200, bridge.start(interval, count))
        elif self.path.startswith("/stop"):
            self._json(200, bridge.stop())
        else:
            self._json(404, {"ok": False})

    def log_message(self, *args):  # keep the helper window quiet
        pass


if __name__ == "__main__":
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
