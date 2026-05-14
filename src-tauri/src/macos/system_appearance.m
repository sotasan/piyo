#import <WebKit/WebKit.h>
#import "piyo.h"

@interface WKWebView (PiyoPrivate)
- (void)_setUseSystemAppearance:(BOOL)useSystemAppearance;
@end

void piyo_install_system_appearance(void *wk_webview_ptr) {
    if (!wk_webview_ptr) return;
    WKWebView *webview = (__bridge WKWebView *)wk_webview_ptr;

    @try {
        if ([webview respondsToSelector:@selector(_setUseSystemAppearance:)]) {
            [webview _setUseSystemAppearance:YES];
        }
    } @catch (NSException *e) {
#ifndef NDEBUG
        NSLog(@"piyo: system_appearance SPI failed: %@", e);
#endif
    }
}
