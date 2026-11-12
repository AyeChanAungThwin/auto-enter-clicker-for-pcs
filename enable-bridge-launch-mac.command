#!/bin/bash
# Registers the enterclickerbridge:// one-click launcher for macOS: builds a
# small .app bundle in this folder that LaunchServices maps to the URL scheme,
# so the web app's "Start bridge" button — and its automatic attempt when the
# page loads — can start bridge.py even when it is not running. Run this once;
# use disable-bridge-launch-mac.command to undo.
set -e
cd "$(dirname "$0")"

APP="EnterClickerBridge.app"
EXE_DIR="$APP/Contents/MacOS"
mkdir -p "$EXE_DIR"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.enterkeyclicker.launcher</string>
  <key>CFBundleName</key><string>EnterClickerBridge</string>
  <key>CFBundleExecutable</key><string>enterhandler</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>Enter Key Clicker Bridge</string>
      <key>CFBundleURLSchemes</key>
      <array><string>enterclickerbridge</string></array>
    </dict>
  </array>
</dict>
</plist>
EOF

cat > "$EXE_DIR/enterhandler" <<'EOF'
#!/bin/bash
DISCOVERED_PROJECT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
PY=python3
command -v python3 >/dev/null 2>&1 || PY=/usr/bin/python3
nohup "$PY" "$DISCOVERED_PROJECT_DIR/bridge.py" >/dev/null 2>&1 &
exit 0
EOF
chmod +x "$EXE_DIR/enterhandler"

echo 'Done — the web app can now launch the bridge itself ("Start bridge" button).'
read -n 1 -s -r -p "Press any key to close."
