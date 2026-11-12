#!/bin/bash
# Registers a LaunchAgent so the bridge starts silently (python3, no window)
# at every login. Run: ./enable-autostart-mac.command  (undo: ./disable...)
set -e
cd "$(dirname "$0")"

PLIST="$HOME/Library/LaunchAgents/com.enterkeyclicker.bridge.plist"
PY="$(command -v python3 || echo /usr/bin/python3)"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.enterkeyclicker.bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$(pwd)/bridge.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
EOF
launchctl load "$PLIST" 2>/dev/null || true
echo "Bridge will now start silently at every login ($PLIST)."
