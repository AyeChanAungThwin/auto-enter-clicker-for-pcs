#!/bin/bash
# Registers EnterClickerBridge.app with macOS LaunchServices as the handler
# for the enterclickerbridge:// scheme — after running this once, the web
# page's Start bridge button (and its auto-start on page load) can launch
# the helper. Chrome asks for permission to open the app the first time.
cd "$(dirname "$0")"
APP="$PWD/EnterClickerBridge.app"
BUNDLE_ID="com.ayechanaungthwin.enterclickerbridge"
SCHEME="enterclickerbridge"

# 1. Make LaunchServices aware of the bundle.
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
"$LSREG" -f "$APP"

# 2. Assign it as the DEFAULT handler for the scheme (lsregister alone does
#    not set the default — Chrome would then find no handler for the URL).
python3 - "$BUNDLE_ID" "$SCHEME" <<'PYEOF'
import ctypes, sys
bundle_id, scheme = sys.argv[1].encode(), sys.argv[2].encode()
cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
cs = ctypes.CDLL("/System/Library/Frameworks/CoreServices.framework/CoreServices")
UTF8 = 0x08000100  # kCFStringEncodingUTF8
cf.CFStringCreateWithCString.restype = ctypes.c_void_p
cf.CFStringCreateWithCString.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32]
s_scheme = cf.CFStringCreateWithCString(None, scheme, UTF8)
s_bundle = cf.CFStringCreateWithCString(None, bundle_id, UTF8)
cs.LSSetDefaultHandlerForURLScheme.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
cs.LSSetDefaultHandlerForURLScheme(s_scheme, s_bundle)
print(f"Default handler for {scheme.decode()} -> {bundle_id.decode()}")
PYEOF

echo ""
echo "Registered: $APP"
echo "Now click 'Start bridge' on the web page — when Chrome asks, press"
echo "'Open Enter Key Clicker Bridge' so the helper may launch."
