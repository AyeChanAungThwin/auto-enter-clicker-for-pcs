#!/bin/bash
# Removes the LaunchAgent created by enable-autostart-mac.command.
set -e
PLIST="$HOME/Library/LaunchAgents/com.enterkeyclicker.bridge.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Bridge auto-start removed."
