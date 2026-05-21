// Public C ABI exposed to Rust via bindgen (see src-tauri/build.rs). Each
// installer is a one-shot, idempotent call that wires a piece of native
// behavior onto the embedded WKWebView. The Rust side wraps these as the
// `macos::*::install` functions.

#ifndef PIYO_MACOS_H
#define PIYO_MACOS_H

#include <stdbool.h>

// Process-wide one-shot: swizzles WKWebView's context-menu hook to strip
// the built-in "Reload" item, which would otherwise rebuild the whole app.
void piyo_install_context_menu(void);

// Per-WebView: opts the webview into ProMotion (>60Hz) rendering by
// flipping a private WebKit feature flag. `wk_webview_ptr` is the raw
// `WKWebView *` from Tauri's `WebviewWindow::with_webview`.
void piyo_install_refresh_rate(void *wk_webview_ptr);

// Per-WebView: enables native control theming (form controls, scrollbars)
// so they follow the system light/dark appearance.
void piyo_install_system_appearance(void *wk_webview_ptr);

// Callback type for the swizzled `applicationShouldTerminate:` handler.
// Return `true` to proceed with quit (NSTerminateNow), `false` to cancel
// (NSTerminateCancel).
typedef bool (*PiyoShouldTerminateCallback)(void);

// One-shot: swizzles `applicationShouldTerminate:` onto the running
// NSApplicationDelegate so the supplied callback decides whether quit
// is allowed. The callback is stored as a static; subsequent calls
// replace it.
void piyo_install_quit_handler(PiyoShouldTerminateCallback callback);

#endif
