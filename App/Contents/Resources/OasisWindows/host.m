#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>
#import <dlfcn.h>
#import <fcntl.h>
#import <sys/mman.h>
#import <unistd.h>

extern void oasis_audio_gain(float value);
extern unsigned oasis_audio_callbacks(void);

// Wine's x86_64 loader ABI needs this address range before Cocoa loads.
__asm__(".zerofill WINE_RESERVE,WINE_RESERVE,_oasis_low_address,0x1fffff000,12");
extern char oasis_low_address[];
struct reserve_item {
    void *address;
    size_t size;
};
static const struct reserve_item areas[] = {{oasis_low_address, 0x1fffff000ULL}, {NULL, 0}};
__attribute__((visibility("default"), used)) const struct reserve_item *wine_main_preload_info = areas;
static __weak NSWindow *game;
static uint32_t targetID;
static int eventID;

// A synthesized scroll event has no AppKit window. Wine needs its original
// window to route the wheel to the correct Windows control. Keep this adapter
// rooted in NSObject so AppKit initialization stays inside Wine startup.
@interface OasisWallpaperScrollEvent : NSObject
@property(nonatomic, strong) NSEvent *sourceEvent;
@property(nonatomic, weak) NSWindow *targetWindow;
@end
@implementation OasisWallpaperScrollEvent
- (NSEventType)type { return NSEventTypeScrollWheel; }
- (NSWindow *)window { return self.targetWindow; }
- (NSInteger)windowNumber { return self.targetWindow.windowNumber; }
- (CGEventRef)CGEvent { return self.sourceEvent.CGEvent; }
- (NSTimeInterval)timestamp { return self.sourceEvent.timestamp; }
- (CGFloat)deltaX { return self.sourceEvent.deltaX; }
- (CGFloat)deltaY { return self.sourceEvent.deltaY; }
@end

@interface NSObject (OasisWineInput)
- (BOOL)handleEvent:(id)event;
@end

static NSScreen *screenForGame(void) {
    for (NSScreen *screen in NSScreen.screens)
        if ([screen.deviceDescription[@"NSScreenNumber"] unsignedIntValue] == targetID)
            return screen;
    return nil;
}
static void placeWindow(void) {
    NSScreen *screen = screenForGame();
    if (!screen)
        return;
    NSWindow *largest = nil;
    Class cls = NSClassFromString(@"WineWindow");
    for (NSWindow *w in NSApp.windows) {
        if (!cls || ![w isKindOfClass:cls] || !w.isVisible || w.frame.size.width < 100 ||
            w.frame.size.height < 70)
            continue;
        if (!largest ||
            NSWidth(w.frame) * NSHeight(w.frame) > NSWidth(largest.frame) * NSHeight(largest.frame))
            largest = w;
    }
    if (!largest)
        return;
    BOOL changed = game != largest;
    game = largest;
    if (NSApp.activationPolicy != NSApplicationActivationPolicyAccessory)
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    NSInteger level = CGWindowLevelForKey(kCGDesktopIconWindowLevelKey) - 1;
    if (largest.level != level)
        largest.level = level;
    if (!largest.ignoresMouseEvents)
        largest.ignoresMouseEvents = YES;
    if (largest.hasShadow)
        largest.hasShadow = NO;
    if (largest.styleMask & NSWindowStyleMaskTitled)
        largest.styleMask = NSWindowStyleMaskBorderless;
    NSWindowCollectionBehavior behavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                          NSWindowCollectionBehaviorStationary |
                                          NSWindowCollectionBehaviorIgnoresCycle;
    if (largest.collectionBehavior != behavior)
        largest.collectionBehavior = behavior;
    if (!NSEqualRects(largest.frame, screen.frame))
        [largest setFrame:screen.frame display:YES];
    if (changed) {
        dprintf(3, "ready %ld %d\n", (long)largest.windowNumber, getpid());
    }
    static unsigned audioSeen;
    unsigned count = oasis_audio_callbacks();
    if (count != audioSeen) {
        audioSeen = count;
        dprintf(3, "audio-ready\n");
    }
}
static void pointer(NSString *line) {
    if ([line isEqual:@"quit"]) {
        NSWindow *w = game;
        id<NSWindowDelegate> delegate = w.delegate;
        if (w && [delegate respondsToSelector:@selector(windowShouldClose:)])
            [delegate windowShouldClose:w];
        else
            _exit(0);
        return;
    }
    if ([line hasPrefix:@"volume "]) {
        oasis_audio_gain([[line substringFromIndex:7] floatValue] / 100.0f);
        return;
    }
    NSWindow *window = game;
    if (!window)
        return;
    NSScanner *scanner = [NSScanner scannerWithString:line];
    NSString *kind = nil;
    double x, y;
    if (![scanner scanUpToString:@" " intoString:&kind] || ![scanner scanDouble:&x] ||
        ![scanner scanDouble:&y] || !isfinite(x) || !isfinite(y))
        return;
    NSPoint local = NSMakePoint(x * NSWidth(window.frame), (1 - y) * NSHeight(window.frame)),
            global = [window convertPointToScreen:local];
    if ([kind isEqual:@"scroll"]) {
        double dx, dy;
        if (![scanner scanDouble:&dx] || ![scanner scanDouble:&dy] ||
            !isfinite(dx) || !isfinite(dy) || fabs(dx) > 8192 || fabs(dy) > 8192 ||
            x < 0 || x > 1 || y < 0 || y > 1)
            return;
        CGEventRef cg = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 2,
                                                     (int32_t)round(dy), (int32_t)round(dx));
        if (!cg)
            return;
        CGEventSetLocation(cg, CGPointMake(global.x, NSMaxY(NSScreen.screens.firstObject.frame) - global.y));
        OasisWallpaperScrollEvent *event = [OasisWallpaperScrollEvent new];
        event.sourceEvent = [NSEvent eventWithCGEvent:cg];
        event.targetWindow = window;
        CFRelease(cg);
        id controller = NSApp.delegate;
        if ([controller respondsToSelector:@selector(handleEvent:)])
            [controller handleEvent:event];
        return;
    }
    NSEventType type;
    if ([kind isEqual:@"down"])
        type = NSEventTypeLeftMouseDown;
    else if ([kind isEqual:@"up"])
        type = NSEventTypeLeftMouseUp;
    else if ([kind isEqual:@"drag"])
        type = NSEventTypeLeftMouseDragged;
    else if ([kind isEqual:@"move"])
        type = NSEventTypeMouseMoved;
    else
        return;
    NSEvent *event = [NSEvent
        mouseEventWithType:type
                  location:local
             modifierFlags:0
                 timestamp:NSProcessInfo.processInfo.systemUptime
              windowNumber:window.windowNumber
                   context:nil
               eventNumber:++eventID
                clickCount:type == NSEventTypeMouseMoved ? 0 : 1
                  pressure:(type == NSEventTypeLeftMouseDown || type == NSEventTypeLeftMouseDragged) ? 1 : 0];
    CGEventRef cg = event.CGEvent;
    if (cg)
        CGEventSetLocation(cg, CGPointMake(global.x, NSMaxY(NSScreen.screens.firstObject.frame) - global.y));
    [NSApp sendEvent:event]; // Delivered only to the Wine instance in this process.
    if (type == NSEventTypeLeftMouseDown)
        placeWindow();
}
int main(int argc, char **argv) {
    if (argc < 3)
        return 64;
    oasis_audio_gain(
        getenv("OASIS_WALLPAPER_VOLUME") ? strtof(getenv("OASIS_WALLPAPER_VOLUME"), NULL) / 100.0f : 0);
    targetID = (uint32_t)strtoul(getenv("OASIS_DISPLAY_ID") ?: "0", NULL, 10);
    if (mmap(areas[0].address, areas[0].size, PROT_NONE, MAP_FIXED | MAP_NORESERVE | MAP_PRIVATE | MAP_ANON,
             -1, 0) == MAP_FAILED)
        return 65;
    char path[4096];
    snprintf(path, sizeof(path), "%s/lib/wine/x86_64-unix/ntdll.so", argv[1]);
    void *lib = dlopen(path, RTLD_NOW | RTLD_GLOBAL);
    if (!lib) {
        fprintf(stderr, "%s\n", dlerror());
        return 66;
    }
    void (*launch)(int, char **) = dlsym(lib, "__wine_main");
    if (!launch)
        return 67;
    static dispatch_source_t timer, input;
    timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
    dispatch_source_set_timer(timer, dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                              150 * NSEC_PER_MSEC, 20 * NSEC_PER_MSEC);
    dispatch_source_set_event_handler(timer, ^{
      @autoreleasepool {
          placeWindow();
      }
    });
    dispatch_resume(timer);
    static NSMutableData *buffer;
    buffer = [NSMutableData data];
    input = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, STDIN_FILENO, 0, dispatch_get_main_queue());
    dispatch_source_set_event_handler(input, ^{
      @autoreleasepool {
          char bytes[4096];
          ssize_t n = read(STDIN_FILENO, bytes, sizeof(bytes));
          if (n <= 0) {
              _exit(0);
          }
          [buffer appendBytes:bytes length:(NSUInteger)n];
          while (buffer.length) {
              const char *p = buffer.bytes, *newline = memchr(p, '\n', buffer.length);
              if (!newline)
                  break;
              NSUInteger size = newline - p;
              NSString *line = [[NSString alloc] initWithBytes:p length:size encoding:NSUTF8StringEncoding];
              [buffer replaceBytesInRange:NSMakeRange(0, size + 1) withBytes:NULL length:0];
              if (line)
                  pointer(line);
          }
          if (buffer.length > 4096)
              [buffer setLength:0];
      }
    });
    dispatch_resume(input);
    argv[1] = "wine";
    setenv("WINELOADERNOEXEC", "1", 1);
    launch(argc - 1, argv + 1);
    return 68;
}
