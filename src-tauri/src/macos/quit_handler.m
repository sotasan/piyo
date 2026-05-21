// Swizzles `applicationShouldTerminate:` onto the running app delegate.
//
// muda routes the predefined Quit menu item directly to
// `-[NSApplication terminate:]`, which bypasses Tauri's WindowEvent and
// RunEvent hooks. The only AppKit-level interception point is the app
// delegate's `applicationShouldTerminate:` method. tao doesn't implement
// it, so we install our own via class_replaceMethod and ask Rust (via
// the stored callback) whether to proceed.

#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import "bindings.h"

static PiyoShouldTerminateCallback g_callback = NULL;

static NSApplicationTerminateReply piyo_application_should_terminate(
    id self,
    SEL _cmd,
    NSApplication *sender)
{
    if (g_callback && !g_callback()) {
        return NSTerminateCancel;
    }
    return NSTerminateNow;
}

void piyo_install_quit_handler(PiyoShouldTerminateCallback callback) {
    g_callback = callback;

    id delegate = [NSApp delegate];
    if (!delegate) return;
    Class cls = object_getClass(delegate);
    if (!cls) return;

    class_replaceMethod(
        cls,
        @selector(applicationShouldTerminate:),
        (IMP)piyo_application_should_terminate,
        "Q@:@");
}
