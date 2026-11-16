#!/bin/bash
# Enter Key Clicker bridge launcher (Linux) — x-scheme-handler target.
# Fired by the browser via the EnterClickerBridge.desktop entry: starts
# bridge.py detached (setsid) from the folder the launcher lives in, then
# returns immediately so the browser is not blocked.
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
setsid nohup python3 bridge.py >/dev/null 2>&1 </dev/null &
exit 0
