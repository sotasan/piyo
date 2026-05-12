#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import "macos.h"

typedef void (*WillOpenMenuIMP)(id, SEL, NSMenu *, NSEvent *);

static WillOpenMenuIMP orig = NULL;

static void replacement(id self, SEL _cmd, NSMenu *menu, NSEvent *event) {
    if (orig) {
        orig(self, _cmd, menu, event);
    }
    if (!menu) return;
    for (NSInteger i = menu.numberOfItems - 1; i >= 0; i--) {
        NSMenuItem *item = [menu itemAtIndex:i];
        if ([item.identifier isEqualToString:@"WKMenuItemIdentifierReload"]) {
            [menu removeItemAtIndex:i];
        }
    }
}

void piyo_install_context_menu(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        Class cls = NSClassFromString(@"WKWebView");
        if (!cls) return;
        Method m = class_getInstanceMethod(cls, @selector(willOpenMenu:withEvent:));
        if (!m) return;
        IMP impl = method_getImplementation(m);
        if (!impl) return;
        orig = (WillOpenMenuIMP)impl;
        method_setImplementation(m, (IMP)replacement);
    });
}
