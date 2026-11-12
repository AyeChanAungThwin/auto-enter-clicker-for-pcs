#!/bin/bash
# Registers an XDG autostart entry so the bridge starts at desktop login
# (GNOME/KDE/XFCE; Wayland and X11 both honor this). Run: ./enable-autostart-linux.sh
set -e
cd "$(dirname "$0")"

PY="$(command -v python3 || echo /usr/bin/python3)"
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
mkdir -p "$AUTOSTART_DIR"

cat > "$AUTOSTART_DIR/enterkeyclicker-bridge.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Enter Key Clicker bridge
Comment=Local helper that sends real Enter presses (port 8791)
Exec=$PY "$(pwd)/bridge.py"
X-GNOME-Autostart-enabled=true
EOF
echo "Bridge will now start at every desktop login ($AUTOSTART_DIR/enterkeyclicker-bridge.desktop)."
