#define main oasisHostMain
#include "../App/Contents/Resources/OasisWindows/host.m"
#undef main

void oasis_audio_gain(float value) {}
unsigned oasis_audio_callbacks(void) { return 0; }

@interface WallpaperInputProbe : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSEvent *event;
@property(nonatomic) int calls;
@end

@implementation WallpaperInputProbe
- (BOOL)handleEvent:(NSEvent *)event {
    self.event = event;
    self.calls++;
    return YES;
}
@end

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        WallpaperInputProbe *probe = [WallpaperInputProbe new];
        NSApp.delegate = probe;
        // This window stays hidden. The real host parser and event adapter run
        // against a probe delegate, without starting a Windows application.
        NSWindow *window = [[NSWindow alloc]
            initWithContentRect:NSMakeRect(100, 200, 600, 400)
                      styleMask:NSWindowStyleMaskBorderless
                        backing:NSBackingStoreBuffered
                          defer:NO];
        game = window;
        pointer(@"scroll 0.5 0.25 3 -5");
        NSCAssert(probe.calls == 1, @"Missing wheel event");
        NSCAssert(probe.event.window == window, @"Wrong target window");
        NSCAssert(probe.event.type == NSEventTypeScrollWheel, @"Wrong event type");
        CGEventRef event = probe.event.CGEvent;
        NSCAssert(CGEventGetIntegerValueField(event, kCGScrollWheelEventPointDeltaAxis1) == -5,
                  @"Incorrect vertical distance");
        NSCAssert(CGEventGetIntegerValueField(event, kCGScrollWheelEventPointDeltaAxis2) == 3,
                  @"Incorrect horizontal distance");
        CGPoint expected = CGPointMake(400, NSMaxY(NSScreen.screens.firstObject.frame) - 500);
        NSCAssert(CGPointEqualToPoint(CGEventGetLocation(event), expected), @"Wrong screen coordinates");
        pointer(@"scroll -1 0.25 0 1");
        pointer(@"scroll 0.5 0.25 0 9000");
        pointer(@"scroll 0.5 0.25 nan 1");
        NSCAssert(probe.calls == 1, @"Invalid event forwarded");
        puts("Original Windows scroll: 7 checks passed");
    }
    return 0;
}
