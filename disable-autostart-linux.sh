#!/bin/bash
# Removes the autostart entry created by enable-autostart-linux.sh.
set -e
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
rm -f "$AUTOSTART_DIR/enterkeyclicker-bridge.desktop"
echo "Bridge auto-start removed."
