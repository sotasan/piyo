//! Process-wide secure input control.
//!
//! When any PTY enters password mode (canonical && !echo on its master
//! termios), we toggle on Carbon's `EnableSecureEventInput`. This is the
//! same API WebKit uses to protect password fields: it tells the kernel
//! to stop delivering keystrokes to tap-based event monitors in other
//! processes. macOS renders a small lock badge in the menu bar while it
//! is active — that's a system-level indicator and not under our
//! control.
//!
//! Refcounted because piyo has multiple tabs: two simultaneous password
//! prompts must both have to release before we disable.

use std::sync::atomic::{AtomicUsize, Ordering};

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn EnableSecureEventInput();
    fn DisableSecureEventInput();
}

static COUNT: AtomicUsize = AtomicUsize::new(0);

pub fn acquire() {
    if COUNT.fetch_add(1, Ordering::SeqCst) == 0 {
        unsafe { EnableSecureEventInput() };
    }
}

pub fn release() {
    let prev = COUNT.fetch_sub(1, Ordering::SeqCst);
    debug_assert!(prev > 0, "secure_input release without acquire");
    if prev == 1 {
        unsafe { DisableSecureEventInput() };
    }
}
