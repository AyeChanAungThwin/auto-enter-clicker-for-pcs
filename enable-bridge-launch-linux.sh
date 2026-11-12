#!/bin/bash
# Registers the enterclickerbridge:// one-click launcher (XDG): a desktop
# entry that maps the URL scheme to bridge.py, so the web app's "Start
# bridge" button — and its automatic attempt when the page loads — can start
# the helper even when it is not running. Run this once;
# disable-bridge-launch-linux.sh undoes it.
set -e
cd "$(dirname "$0")"

APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS_DIR"
BRIDGE_DIR="$(pwd)"

cat > "$APPS_DIR/enterkeyclicker-bridge-launch.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Enter Key Clicker bridge launcher
Comment=Starts the local helper for the web app's Start bridge button
MimeType=x-scheme-handler/enterclickerbridge;
Exec=python3 "$BRIDGE_DIR/bridge.py"
Terminal=false
NoDisplay=true
EOF
chmod +x "$APPS_DIR/enterkeyclicker-bridge-launch.desktop"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR"
xdg-mime default enterkeyclicker-bridge-launch.desktop x-scheme-handler/enterclickerbridge
echo 'Done — the web app can now launch the bridge itself ("Start bridge" button).'
