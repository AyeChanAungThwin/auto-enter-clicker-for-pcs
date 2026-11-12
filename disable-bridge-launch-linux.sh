#!/bin/bash
# Removes the enterclickerbridge:// launcher registered by
# enable-bridge-launch-linux.sh.
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
rm -f "$APPS_DIR/enterkeyclicker-bridge-launch.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR"
echo 'The one-click "Start bridge" launcher has been removed.'
