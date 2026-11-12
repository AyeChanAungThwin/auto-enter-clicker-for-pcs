#!/bin/bash
# Removes the enterclickerbridge:// launcher registered by
# enable-bridge-launch-mac.command: unregisters the .app from LaunchServices
# and deletes it.
cd "$(dirname "$0")"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
if [ -d "EnterClickerBridge.app" ]; then
  "$LSREG" -u "$PWD/EnterClickerBridge.app" 2>/dev/null || true
  rm -rf "EnterClickerBridge.app"
fi
echo 'The one-click "Start bridge" launcher has been removed.'
read -n 1 -s -r -p "Press any key to close."
