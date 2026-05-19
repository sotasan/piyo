// Unlock ProMotion (>60Hz) rendering inside WKWebView.
//
// On ProMotion displays (MacBook Pro 14"/16", recent iPads), WebKit caps
// web content rendering at 60fps unless the host opts in. Without this,
// the entire piyo UI — scrolling the terminal, animating the sidebar,
// cursor blink — runs at 60Hz on a 120Hz panel. The opt-in is gated
// behind a private WebKit feature flag, `PreferPageRenderingUpdatesNear-
// 60FPSEnabled`, which we toggle off via the `_WKFeature` SPI.
//
// Safety: every call site is guarded by `respondsToSelector:` and wrapped
// in `@try` so an OS update that renames/removes the feature degrades to
// a 60Hz webview rather than crashing. The feature key string is stable
// across the macOS versions we ship to (14+) but Apple makes no promises.

#import <WebKit/WebKit.h>
#import "bindings.h"

// Forward-declare the private WebKit interfaces we touch. The actual
// symbols ship in WebKit.framework; this just teaches the compiler their
// shape so we can call them without dynamic dispatch boilerplate.
@interface WKPreferences (PiyoPrivate)
+ (NSArray *)_features;
- (void)_setEnabled:(BOOL)enabled forFeature:(id)feature;
@end

@interface _WKFeature : NSObject
- (NSString *)key;
@end

void piyo_install_refresh_rate(void *wk_webview_ptr) {
    if (!wk_webview_ptr) return;
    WKWebView *webview = (__bridge WKWebView *)wk_webview_ptr;

    @try {
        WKPreferences *prefs = webview.configuration.preferences;
        Class prefsClass = [WKPreferences class];

        // Bail silently if the SPI shape changed in this macOS version.
        if (![prefsClass respondsToSelector:@selector(_features)]) return;
        if (![prefs respondsToSelector:@selector(_setEnabled:forFeature:)]) return;

        for (_WKFeature *feature in [WKPreferences _features]) {
            if ([feature.key isEqualToString:@"PreferPageRenderingUpdatesNear60FPSEnabled"]) {
                [prefs _setEnabled:NO forFeature:feature];
                return;
            }
        }
    } @catch (NSException *e) {
#ifndef NDEBUG
        NSLog(@"piyo: refresh_rate SPI failed: %@", e);
#endif
    }
}
