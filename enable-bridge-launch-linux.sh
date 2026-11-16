#!/bin/bash
# Registers the Enter Key Clicker bridge as the handler for the
# enterclickerbridge:// scheme (xdg default for this desktop entry), so the
# web page's Start bridge button (and its auto-start on page load) can
# launch the helper — after running this once, no window appears; the badge
# turning green is the confirmation.
DIR="$(cd "$(dirname "$0")" && pwd)"
APPS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS_DIR"
sed "s|__DIR__|$DIR|g" "$DIR/EnterClickerBridge.desktop" > "$APPS_DIR/enterclickerbridge.desktop"
xdg-mime default enterclickerbridge.desktop x-scheme-handler/enterclickerbridge
echo ""
echo "Registered: $APPS_DIR/enterclickerbridge.desktop"
echo "Now click 'Start bridge' on the web page — the helper starts silently."
