use tauri::{AppHandle, Emitter};

use crate::pty::types::{
    EVENT_PTY_BELL, EVENT_PTY_MODES, EVENT_PTY_TITLE, PtyBell, PtyModes, PtyTitle,
};
use crate::vt::{self, BellListener, ModeListener, MouseTracking, TitleListener};

pub(super) struct ModeEmit {
    pub app: AppHandle,
    pub rid: u32,
}

impl ModeListener for ModeEmit {
    fn on_modes(&self, modes: &vt::Modes) {
        let _ = self.app.emit(
            EVENT_PTY_MODES,
            PtyModes {
                rid: self.rid,
                mouse_tracking: !matches!(modes.mouse_tracking, MouseTracking::None),
                bracketed_paste: modes.bracketed_paste,
                focus_event: modes.focus_event,
            },
        );
    }
}

pub(super) struct TitleEmit {
    pub app: AppHandle,
    pub rid: u32,
}

impl TitleListener for TitleEmit {
    fn on_title(&self, title: &str) {
        let _ = self.app.emit(
            EVENT_PTY_TITLE,
            PtyTitle {
                rid: self.rid,
                title: title.to_string(),
            },
        );
    }
}

pub(super) struct BellEmit {
    pub app: AppHandle,
    pub rid: u32,
}

impl BellListener for BellEmit {
    fn on_bell(&self) {
        let _ = self.app.emit(EVENT_PTY_BELL, PtyBell { rid: self.rid });
    }
}
