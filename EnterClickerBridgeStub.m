// EnterClickerBridge — native scheme-handler app (macOS)
//
// A bash script cannot answer the open-URL Apple event macOS sends for
// enterclickerbridge:// when the app is already running — every such launch
// then surfaces "the application is not responding" (LS error -1712). This
// stub answers the events and supervises bridge.py itself: it restarts the
// helper if macOS kills it, honors the stop file a Stop bridge writes, and
// a fresh URL event clears a pending stop (that's "Start bridge"). It runs
// for the whole session and is only quit when the Mac does.
//
// It also OWNS THE PRESSES: macOS gives the Accessibility grant to this app
// (by bundle identity), and that grant does NOT flow down to bridge.py's
// python/osascript grandchildren — CGEventPost from them was silently
// dropped while this process's own events land fine. So the press loop runs
// here, natively (keydown/hold/keyup via CGEvent, identical timing to the
// JXA loop), and bridge.py delegates to it on 127.0.0.1:8792:
//   GET  /ax    -> {"trusted":bool,"pressing":bool}
//   POST /press -> {"interval","count","click","tab","targets": [[x,y],..]}
//                  starts the burst loop; {"ok":false,"busy":true} if running
//   POST /stop  -> asks the loop to stop within ~0.1 s

#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <arpa/inet.h>
#import <string.h>
#import <sys/socket.h>
#import <unistd.h>

static NSString *const kStopFile = @"/tmp/ech-bridge-stopped";
static NSString *const kPingURL = @"http://127.0.0.1:8791/ping";
static NSString *const kLogPath = @"/tmp/ech-app-bridge.log";
static int const kPressPort = 8792;

static NSTask *gTask = nil;

// Press-loop state. gPressing is flipped before the loop thread starts so a
// second /press can never double-spawn; gStopPresses is sampled every ≤0.1s
// (also inside the interval sleep) so /stop always takes effect quickly.
static volatile BOOL gPressing = NO;
static volatile BOOL gStopPresses = NO;

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
    @try {
        [t launch];
    } @catch (NSException *ex) {
        // A failed NSTask launch used to abort the whole app from this
        // supervise thread (NSConcreteTask launchWithDictionary threw once;
        // macOS showed "EnterClickerBridge quit unexpectedly"). Log it and
        // let the loop retry; the port-busy case self-heals on the next pass.
        appendLog([NSString stringWithFormat:@"python launch failed: %@ — %@\n",
                   ex.name, ex.reason]);
        return;
    }
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

// ---------------------------------------------------------------------------
// Native press loop (the process holding the Accessibility grant)
// ---------------------------------------------------------------------------

static void tapKey(CGEventSourceRef src, CGKeyCode key) {
    CGEventRef down = CGEventCreateKeyboardEvent(src, key, YES);
    CGEventPost(kCGHIDEventTap, down);
    if (down) CFRelease(down);
    usleep(20000);
    CGEventRef up = CGEventCreateKeyboardEvent(src, key, NO);
    CGEventPost(kCGHIDEventTap, up);
    if (up) CFRelease(up);
    usleep(50000);
}

static void clickXY(CGEventSourceRef src, double x, double y) {
    CGPoint pt = CGPointMake(x, y);
    CGEventRef mv = CGEventCreateMouseEvent(src, kCGEventMouseMoved, pt, 0);
    CGEventPost(kCGHIDEventTap, mv);
    if (mv) CFRelease(mv);
    usleep(20000);
    CGEventRef down = CGEventCreateMouseEvent(src, kCGEventLeftMouseDown, pt, 0);
    CGEventPost(kCGHIDEventTap, down);
    if (down) CFRelease(down);
    usleep(20000);
    CGEventRef up = CGEventCreateMouseEvent(src, kCGEventLeftMouseUp, pt, 0);
    CGEventPost(kCGHIDEventTap, up);
    if (up) CFRelease(up);
    usleep(50000);
}

// JXA-loop parity: sleep the interval first, then fire the whole target list
// as one burst with 0.2 s between entries; each entry is Click → Tab? → Enter.
static void runPressCycle(NSDictionary *cfg) {
    double interval = [cfg[@"interval"] doubleValue];
    long count = [cfg[@"count"] longValue];
    BOOL tab = [cfg[@"tab"] boolValue];
    BOOL click = [cfg[@"click"] boolValue];
    NSArray *targets = cfg[@"targets"];
    long steps = targets.count > 0 ? (long)targets.count : 1;
    CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
    long done = 0;
    while (!gStopPresses && (count == 0 || done < count)) {
        double remaining = interval;
        while (remaining > 0 && !gStopPresses) {
            double slice = remaining > 0.1 ? 0.1 : remaining;
            usleep((useconds_t)(slice * 1000000));
            remaining -= slice;
        }
        if (gStopPresses) break;
        for (long j = 0; j < steps; j++) {
            if (gStopPresses) break;
            if (count != 0 && done >= count) break;
            if (targets.count > 0 && click) {
                NSArray *xy = targets[j % targets.count];
                clickXY(src, [xy[0] doubleValue], [xy[1] doubleValue]);
            }
            if (tab) tapKey(src, 48);   // kVK_Tab
            tapKey(src, 36);            // kVK_Return
            done++;
            if (j < steps - 1) usleep(200000);
        }
    }
    if (src) CFRelease(src);
    gPressing = NO;
}

static void startPressCycle(NSDictionary *cfg) {
    gStopPresses = NO;
    gPressing = YES;
    NSDictionary *copy = [cfg copy];
    [NSThread detachNewThreadWithBlock:^{
        runPressCycle(copy);
    }];
}

// ---------------------------------------------------------------------------
// Native aim overlay — the "Pick" flow. bridge.py forwards /aim here and the
// overlay windows cover every NSScreen, so a press target is pickable
// anywhere on the screen, not just inside the browser page (the old Tk
// overlay was page-only once it failed). Coordinates come straight from the
// event's CGEvent via CGEventGetLocation — the same top-left-origin display
// space CGEventPost targets in clickXY — so no NSScreen↔CG conversion.
// ---------------------------------------------------------------------------

static volatile BOOL gAimActive = NO;
static NSArray<NSWindow *> *gAimWins = nil;
static CGPoint gAimPoint;
static BOOL gAimPicked = NO;
static volatile int gAimGen = 0;   // voids stale timeout blocks across sessions
static dispatch_semaphore_t gAimSem = nil;

static void aimFinishMain(void) {   // main thread only
    dispatch_semaphore_t sem = gAimSem;
    for (NSWindow *w in gAimWins) {
        [w orderOut:nil];
        [w close];
    }
    gAimWins = nil;
    gAimSem = nil;
    dispatch_semaphore_signal(sem);
}

@interface AimWindow : NSWindow
@end
@implementation AimWindow
// Borderless windows are non-key by default and would never see Esc.
- (BOOL)canBecomeKeyWindow { return YES; }
@end

@interface AimView : NSView {
    NSPoint pt;   // crosshair position in view coordinates
}
@end
@implementation AimView
- (instancetype)initWithFrame:(NSRect)frame {
    self = [super initWithFrame:frame];
    if (self) pt = NSMakePoint(frame.size.width / 2, frame.size.height / 2);
    return self;
}
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)acceptsFirstResponder { return YES; }
- (void)updateTrackingAreas {
    [super updateTrackingAreas];
    for (NSTrackingArea *a in [self.trackingAreas copy])
        [self removeTrackingArea:a];
    [self addTrackingArea:[[NSTrackingArea alloc]
        initWithRect:self.bounds
             options:NSTrackingMouseMoved | NSTrackingActiveAlways
               owner:self userInfo:nil]];
}
- (void)mouseMoved:(NSEvent *)event {
    pt = [self convertPoint:event.locationInWindow fromView:nil];
    [self setNeedsDisplay:YES];
}
- (void)mouseDown:(NSEvent *)event {
    if (event.type != NSEventTypeLeftMouseDown) return;
    CGEventRef cge = event.CGEvent;
    gAimPoint = cge ? CGEventGetLocation(cge) : gAimPoint;
    gAimPicked = YES;
    aimFinishMain();
}
- (void)keyDown:(NSEvent *)event {
    if (event.keyCode == 53) aimFinishMain();   // kVK_Escape → cancelled
}
- (void)drawRect:(NSRect)rect {
    [[NSColor colorWithWhite:0 alpha:0.35] setFill];
    NSRectFill(rect);
    // Crosshair through the cursor, in the same indigo palette as the page.
    NSBezierPath *lines = [NSBezierPath bezierPath];
    [lines moveToPoint:NSMakePoint(rect.origin.x, pt.y)];
    [lines lineToPoint:NSMakePoint(rect.origin.x + rect.size.width, pt.y)];
    [lines moveToPoint:NSMakePoint(pt.x, rect.origin.y)];
    [lines lineToPoint:NSMakePoint(pt.x, rect.origin.y + rect.size.height)];
    [lines setLineWidth:2];
    [[NSColor colorWithSRGBRed:0.506 green:0.549 blue:0.973 alpha:1] setStroke];
    [lines stroke];
    NSBezierPath *ring = [NSBezierPath bezierPathWithOvalInRect:
        NSMakeRect(pt.x - 16, pt.y - 16, 32, 32)];
    [ring setLineWidth:2];
    [ring stroke];
    NSDictionary *attrs = @{
        NSFontAttributeName: [NSFont boldSystemFontOfSize:24],
        NSForegroundColorAttributeName: [NSColor colorWithSRGBRed:0.647
            green:0.706 blue:0.989 alpha:1],
    };
    NSString *hint = @"Click to set the press target — Esc cancels";
    NSSize sz = [hint sizeWithAttributes:attrs];
    [hint drawAtPoint:NSMakePoint(rect.origin.x + rect.size.width / 2 - sz.width / 2,
                                  rect.origin.y + rect.size.height - 70)
       withAttributes:attrs];
}
@end

static void showAimOverlayMain(double timeout) {   // main thread only
    NSMutableArray *wins = [NSMutableArray array];
    for (NSScreen *screen in [NSScreen screens]) {
        AimWindow *w = [[AimWindow alloc]
            initWithContentRect:screen.frame
                      styleMask:NSWindowStyleMaskBorderless
                        backing:NSBackingStoreBuffered
                          defer:NO screen:screen];
        w.level = NSScreenSaverWindowLevel;
        w.opaque = NO;
        w.hasShadow = NO;
        w.backgroundColor = [NSColor clearColor];
        w.releasedWhenClosed = NO;
        w.contentView = [[AimView alloc] initWithFrame:screen.frame];
        [wins addObject:w];
    }
    gAimWins = wins;
    for (NSWindow *w in wins) {
        if (w == wins.lastObject) [w makeKeyAndOrderFront:nil];
        else [w orderFrontRegardless];
    }
    [NSApp activateIgnoringOtherApps:YES];
    // Belt-and-braces self-cancel: the HTTP waiter's semaphore has a small
    // grace beyond `timeout`, so the overlay itself must end the session.
    // gAimGen voids blocks left over from a finished overlay session.
    int gen = gAimGen;
    dispatch_after(
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)(timeout * NSEC_PER_SEC)),
        dispatch_get_main_queue(), ^{
            if (gAimWins && gAimGen == gen) aimFinishMain();
        });
}

// Runs on a detached HTTP-handler thread; blocks until the pick resolves.
static NSString *runAimOverlay(double timeout) {
    if (gAimActive) return @"{\"ok\":false,\"reason\":\"unavailable\"}";
    gAimActive = YES;
    gAimGen++;
    gAimPicked = NO;
    gAimSem = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_main_queue(), ^{
        showAimOverlayMain(timeout);
    });
    dispatch_semaphore_wait(gAimSem,
        dispatch_time(DISPATCH_TIME_NOW, (int64_t)((timeout + 2.0) * NSEC_PER_SEC)));
    NSString *reply = gAimPicked
        ? [NSString stringWithFormat:@"{\"ok\":true,\"x\":%d,\"y\":%d}",
              (int)gAimPoint.x, (int)gAimPoint.y]
        : @"{\"ok\":false,\"reason\":\"cancelled\"}";
    gAimActive = NO;
    return reply;
}

static NSString *jsonReply(NSString *body) {
    return [NSString stringWithFormat:
        @"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n"
        @"Content-Length: %lu\r\nConnection: close\r\n\r\n%@",
        (unsigned long)[body lengthOfBytesUsingEncoding:NSUTF8StringEncoding], body];
}

// One connection at a time is plenty: the only clients are bridge.py (every
// /ping hits /ax) and the page's one-per-second poll behind it.
static void servePressPort(void) {
    int lsock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (lsock < 0) { appendLog(@"press port: socket failed\n"); return; }
    int yes = 1;
    setsockopt(lsock, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    addr.sin_port = htons(kPressPort);
    if (bind(lsock, (struct sockaddr *)&addr, sizeof addr) != 0) {
        appendLog(@"press port: bind failed\n");
        close(lsock);
        return;
    }
    for (;;) {
        if (listen(lsock, 8) != 0) continue;
        int c = accept(lsock, NULL, NULL);
        if (c < 0) continue;
        // 1 s receive timeout: a client that never completes its request
        // (or sends none) must not wedge the server — every read simply
        // times out and the connection is answered 400 / closed.
        struct timeval tv = {1, 0};
        setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
        // Read the request head, then the body when Content-Length says one.
        NSMutableData *buf = [NSMutableData data];
        NSData *limit = [@"\r\n\r\n" dataUsingEncoding:NSUTF8StringEncoding];
        NSRange head = {NSNotFound, 0};
        while (head.location == NSNotFound) {
            uint8_t tmp[2048];
            ssize_t n = read(c, tmp, sizeof tmp);
            if (n <= 0) break;
            [buf appendBytes:tmp length:(NSUInteger)n];
            NSRange full = [buf rangeOfData:limit options:0 range:NSMakeRange(0, buf.length)];
            head = full;
        }
        NSString *headStr = head.location == NSNotFound
            ? nil
            : [[NSString alloc] initWithData:[buf subdataWithRange:NSMakeRange(0, head.location)]
                                    encoding:NSUTF8StringEncoding];
        NSData *body = nil;
        if (head.location != NSNotFound) {
            NSUInteger bodyStart = head.location + limit.length;
            // Honor Content-Length only: urllib sends the tiny JSON right
            // after the head, but curl-style GETs carry none — waiting for
            // bytes that never come must be impossible here.
            NSRange cl = [headStr rangeOfString:@"Content-Length:" options:NSCaseInsensitiveSearch];
            int want = 0;
            if (cl.location != NSNotFound) {
                NSScanner *sc = [NSScanner scannerWithString:
                    [headStr substringFromIndex:cl.location + cl.length]];
                [sc scanInt:&want];
                if (want < 0) want = 0;
            }
            while (want > 0 && buf.length < bodyStart + (NSUInteger)want) {
                uint8_t tmp[4096];
                ssize_t n = read(c, tmp, sizeof tmp);
                if (n <= 0) break;
                [buf appendBytes:tmp length:(NSUInteger)n];
            }
            if (buf.length > bodyStart)
                body = [buf subdataWithRange:NSMakeRange(bodyStart, buf.length - bodyStart)];
        }
        NSString *reply = nil;
        if ([headStr hasPrefix:@"GET /ax"]) {
            reply = jsonReply([NSString stringWithFormat:
                @"{\"trusted\":%@,\"pressing\":%@}",
                AXIsProcessTrusted() ? @"true" : @"false",
                gPressing ? @"true" : @"false"]);
        } else if ([headStr hasPrefix:@"POST /stop"]) {
            gStopPresses = YES;
            reply = jsonReply(@"{\"ok\":true}");
        } else if ([headStr hasPrefix:@"POST /press"]) {
            NSDictionary *cfg = body
                ? [NSJSONSerialization JSONObjectWithData:body options:0 error:nil]
                : nil;
            if (cfg[@"interval"] == nil || cfg[@"targets"] == nil) {
                reply = jsonReply(@"{\"ok\":false,\"error\":\"bad payload\"}");
            } else if (gPressing) {
                reply = jsonReply(@"{\"ok\":false,\"busy\":true}");
            } else {
                startPressCycle(cfg);
                reply = jsonReply(@"{\"ok\":true}");
            }
        } else if ([headStr hasPrefix:@"POST /aim"]) {
            // The overlay blocks for up to `timeout` seconds — the accept
            // loop must keep answering /ax, /press, /stop meanwhile, so the
            // aim handler lives on its own thread (it owns the reply/close).
            NSDictionary *cfg = body
                ? [NSJSONSerialization JSONObjectWithData:body options:0 error:nil]
                : nil;
            double aimTimeout = 15.0;
            if (cfg[@"timeout"] != nil) {
                double t = [cfg[@"timeout"] doubleValue];
                if (t >= 1 && t <= 60) aimTimeout = t;
            }
            int aimSock = c;
            [NSThread detachNewThreadWithBlock:^{
                NSData *out = [jsonReply(runAimOverlay(aimTimeout))
                    dataUsingEncoding:NSUTF8StringEncoding];
                write(aimSock, out.bytes, out.length);
                close(aimSock);
            }];
        } else {
            reply = jsonReply(@"{\"ok\":false}");
        }
        if (reply == nil) continue;   // handled asynchronously on its own thread
        NSData *out = [reply dataUsingEncoding:NSUTF8StringEncoding];
        write(c, out.bytes, out.length);
        close(c);
    }
}

// The press service lives on its own thread: dispatch I/O off the run loop.
static void launchPressService(void) {
    [NSThread detachNewThreadWithBlock:^{ servePressPort(); }];
}

// ---------------------------------------------------------------------------
// Scheme-handler app
// ---------------------------------------------------------------------------

static void promptAccessibilityIfNeeded(void) {
    if (AXIsProcessTrusted()) return;
    // Raise macOS's own "EnterClickerBridge wants to control your computer"
    // prompt: as a native app process this call is stable (only the ctypes
    // version bridge.py used to spawn segfaulted), and an Allow clicked here
    // writes a TCC grant carrying THIS build's signature — the manual add/
    // remove dance in System Settings misses that when the pane's list went
    // stale after a reset.
    CFStringRef key = CFSTR("AXTrustedCheckOptionPrompt");
    CFDictionaryRef opts = CFDictionaryCreate(
        kCFAllocatorDefault,
        (const void **)&key, (const void **)&kCFBooleanTrue, 1,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    AXIsProcessTrustedWithOptions(opts);
    CFRelease(opts);
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
        promptAccessibilityIfNeeded();
        launchPressService();
        [NSThread detachNewThreadWithBlock:^{ superviseLoop(); }];
        [app run];
    }
    return 0;
}
