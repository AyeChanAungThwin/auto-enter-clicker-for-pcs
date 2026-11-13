// EnterClickerBridge — native scheme-handler app (macOS)
//
// A bash script cannot answer the open-URL Apple event macOS sends for
// enterclickerbridge:// when the app is already running — every such launch
// then surfaces "the application is not responding" (LS error -1712). This
// stub answers the events and supervises bridge.py itself: it restarts the
// helper if macOS kills it, honors the stop file a Stop bridge writes, and
// a fresh URL event clears a pending stop (that's "Start bridge"). It runs
// for the whole session and is only quit when the Mac does.

#import <AppKit/AppKit.h>

static NSString *const kStopFile = @"/tmp/ech-bridge-stopped";
static NSString *const kPingURL = @"http://127.0.0.1:8791/ping";
static NSString *const kLogPath = @"/tmp/ech-app-bridge.log";

static NSTask *gTask = nil;

static NSString *bridgeDir(void) {
    // <dir>/EnterClickerBridge.app/Contents/MacOS/this → <dir>
    NSString *exe = [NSBundle mainBundle].executablePath;
    return [[[[exe stringByDeletingLastPathComponent]
                    stringByDeletingLastPathComponent]
                    stringByDeletingLastPathComponent]
                        stringByDeletingLastPathComponent];
}

static BOOL bridgeServing(void) {
    NSTask *curl = [NSTask new];
    curl.executableURL = [NSURL fileURLWithPath:@"/usr/bin/curl"];
    curl.arguments = @[@"-s", @"--max-time", @"1", kPingURL];
    NSPipe *out = [NSPipe pipe];
    curl.standardOutput = out;
    curl.standardError = [NSFileHandle fileHandleWithNullDevice];
    if (@available(macOS 10.13, *)) { if (![curl launchAndReturnError:nil]) return NO; }
    else [curl launch];
    [curl waitUntilExit];
    NSString *body = [[NSString alloc]
        initWithData:[out.fileHandleForReading readDataToEndOfFile]
            encoding:NSUTF8StringEncoding];
    return [body containsString:@"\"ok\""];
}

static void appendLog(NSString *text) {
    NSFileHandle *log = [NSFileHandle fileHandleForWritingAtPath:kLogPath];
    if (!log) {
        [text writeToFile:kLogPath atomically:YES encoding:NSUTF8StringEncoding error:nil];
        log = [NSFileHandle fileHandleForWritingAtPath:kLogPath];
        if (!log) return;
    }
    [log seekToEndOfFile];
    [log writeData:[text dataUsingEncoding:NSUTF8StringEncoding]];
}

static void spawnPython(void) {
    NSTask *t = [NSTask new];
    t.executableURL = [NSURL fileURLWithPath:@"/bin/bash"];
    // No `arch` force needed: this stub is built for both slices and LaunchServices
    // runs it natively, so the python child inherits the native slice.
    t.arguments = @[@"-c", @"/usr/bin/env python3 -u bridge.py"];
    t.currentDirectoryPath = bridgeDir();
    NSMutableDictionary *env = [NSMutableDictionary
        dictionaryWithDictionary:NSProcessInfo.processInfo.environment];
    env[@"ECH_STOP_FILE"] = kStopFile;
    t.environment = env;
    NSFileHandle *log = [NSFileHandle fileHandleForWritingAtPath:kLogPath];
    if (log) { [log seekToEndOfFile]; t.standardOutput = log; t.standardError = log; }
    [t launch];
    gTask = t;
    [NSThread detachNewThreadWithBlock:^{
        [t waitUntilExit];
        appendLog([NSString
            stringWithFormat:@"python exited %d at %@\n", (int)t.terminationStatus,
            [NSDateFormatter localizedStringFromDate:[NSDate date]
                          dateStyle:NSDateFormatterNoStyle
                          timeStyle:NSDateFormatterMediumStyle]]);
    }];
}

static void startBridge(void) {
    [NSFileManager.defaultManager removeItemAtPath:kStopFile error:nil];
    // The supervisor loop picks this up within ~2 s.
}

static void superviseLoop(void) {
    while (YES) {
        BOOL stopped = [NSFileManager.defaultManager fileExistsAtPath:kStopFile];
        if (!stopped && !bridgeServing() && (!gTask || !gTask.isRunning)) {
            spawnPython();
            [NSThread sleepForTimeInterval:3];  // let python bind (or hit the busy port)
            continue;
        }
        [NSThread sleepForTimeInterval:2];
    }
}

@interface BridgeDelegate : NSObject <NSApplicationDelegate>
- (void)handleGetURLEvent:(NSAppleEventDescriptor *)event reply:(NSAppleEventDescriptor *)reply;
@end

@implementation BridgeDelegate
- (void)handleGetURLEvent:(NSAppleEventDescriptor *)event reply:(NSAppleEventDescriptor *)reply {
    startBridge();
}
- (void)applicationWillFinishLaunching:(NSNotification *)note {
    [[NSAppleEventManager sharedAppleEventManager]
        setEventHandler:self
           andSelector:@selector(handleGetURLEvent:reply:)
         forEventClass:kInternetEventClass
              andEventID:kAEGetURL];
}
- (BOOL)applicationShouldHandleReopen:(NSApplication *)app hasVisibleWindows:(BOOL)flag {
    return YES;  // activation clicks are answered too; start the bridge while at it
}
- (void)applicationDidBecomeActive:(NSNotification *)note {
    startBridge();
}
@end

int main(int argc, const char **argv) {
    @autoreleasepool {
        BridgeDelegate *delegate = [BridgeDelegate new];
        NSApplication *app = [NSApplication sharedApplication];
        app.delegate = delegate;
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [NSThread detachNewThreadWithBlock:^{ superviseLoop(); }];
        [app run];
    }
    return 0;
}
