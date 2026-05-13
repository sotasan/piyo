#import <WebKit/WebKit.h>
#import "piyo.h"

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
