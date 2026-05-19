// Make WKWebView's native controls follow the system light/dark theme.
//
// Tauri creates WKWebView without `_setUseSystemAppearance:` set, so
// native form controls (date pickers, native <select> popups, scrollbars,
// focus rings) render in the default "aqua" appearance regardless of the
// system theme. Toggling this private SPI on lets WebKit adopt the
// effective NSAppearance of the hosting window, so a dark-mode user sees
// dark scrollbars instead of bright bars on the terminal panel.
//
// CSS `color-scheme` and `prefers-color-scheme` aren't enough — those
// only affect content; they don't reach AppKit-drawn chrome inside the
// webview. The private setter is the only knob.

#import <WebKit/WebKit.h>
#import "bindings.h"

@interface WKWebView (PiyoPrivate)
- (void)_setUseSystemAppearance:(BOOL)useSystemAppearance;
@end

void piyo_install_system_appearance(void *wk_webview_ptr) {
    if (!wk_webview_ptr) return;
    WKWebView *webview = (__bridge WKWebView *)wk_webview_ptr;

    @try {
        // respondsToSelector + @try: if Apple ever renames or removes the
        // SPI, we skip the call rather than crash. Aqua-styled controls
        // are a cosmetic regression, not a functional one.
        if ([webview respondsToSelector:@selector(_setUseSystemAppearance:)]) {
            [webview _setUseSystemAppearance:YES];
        }
    } @catch (NSException *e) {
#ifndef NDEBUG
        NSLog(@"piyo: system_appearance SPI failed: %@", e);
#endif
    }
}
