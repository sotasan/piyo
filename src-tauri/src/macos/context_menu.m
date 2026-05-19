// Strip the "Reload" item from WKWebView's right-click context menu.
//
// WKWebView always injects a "Reload" entry into its default context menu.
// Triggering it in piyo would re-fetch the bundled HTML/JS shell from
// scratch — the user loses every open tab, every PTY, every selection.
// There is no public API to remove a single default item (the public
// `WKUIDelegate` only lets you replace the entire menu wholesale), so we
// swizzle `-[WKWebView willOpenMenu:withEvent:]` (a private AppKit hook
// invoked just before the menu is presented) and drop the matching item
// by its stable `WKMenuItemIdentifierReload` identifier.
//
// Swizzling: install once at process startup, store the original IMP,
// chain to it from our replacement so any other AppKit hosts that rely on
// the default behavior keep working.

#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#import "bindings.h"

typedef void (*WillOpenMenuIMP)(id, SEL, NSMenu *, NSEvent *);

static WillOpenMenuIMP orig = NULL;

static void replacement(id self, SEL _cmd, NSMenu *menu, NSEvent *event) {
    // Let WebKit populate the menu first, then prune. Iterating in reverse
    // so removeItemAtIndex: doesn't shift indices we're about to visit.
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
    // dispatch_once: swizzling is process-wide; doing it twice would
    // chain the replacement to itself and recurse.
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
