//! Terminal-mode mirror plus the listener traits the [`super::Session`]
//! uses to bridge ghostty callbacks back to the host.

use std::sync::{Arc, Mutex};

/// Thread-safe snapshot of the terminal modes the key / mouse encoders need.
/// Refreshed after every `vt_write` so Tauri-thread encoders can configure
/// themselves without touching the `!Send` `libghostty_vt::Terminal`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Modes {
    pub cursor_key_application: bool,
    pub keypad_key_application: bool,
    pub alt_esc_prefix: bool,
    pub kitty_flags: u8,
    pub mouse_tracking: MouseTracking,
    pub mouse_format: MouseFormat,
    /// DEC mode 2004 — when on, paste operations should wrap input in
    /// `\x1b[200~ … \x1b[201~` so the shell treats it as one block.
    pub bracketed_paste: bool,
    /// DEC mode 1004 — when on, the terminal should emit `\x1b[I` / `\x1b[O`
    /// on focus gain / loss so the running app can react.
    pub focus_event: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MouseTracking {
    #[default]
    None,
    X10,
    Normal,
    Button,
    Any,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MouseFormat {
    #[default]
    X10,
    Utf8,
    Sgr,
    Urxvt,
    SgrPixels,
}

pub type SharedModes = Arc<Mutex<Modes>>;

/// Notified whenever the session refreshes its mode cache so the frontend
/// can mirror state (e.g. mouse-tracking on/off) without IPC roundtrips.
pub trait ModeListener: Send + 'static {
    fn on_modes(&self, modes: &Modes);
}

/// Notified when the session produces a new title.
pub trait TitleListener: Send + 'static {
    fn on_title(&self, title: &str);
}

/// Notified each time the terminal receives a BEL (`\x07`).
pub trait BellListener: Send + 'static {
    fn on_bell(&self);
}
