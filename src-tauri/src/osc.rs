use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;
use vte::Perform;

pub struct OscPerformer {
    app: AppHandle,
}

impl OscPerformer {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl Perform for OscPerformer {
    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        let Some(&code) = params.first() else { return };
        match code {
            b"0" | b"2" => {
                if let Some(title) = join_payload(params) {
                    let _ = self.app.emit("pty:title", &title);
                }
            }
            b"9" => {
                if let Some(msg) = join_payload(params) {
                    let _ = self
                        .app
                        .notification()
                        .builder()
                        .title("Piyo")
                        .body(msg)
                        .show();
                }
            }
            _ => {}
        }
    }
}

fn join_payload(params: &[&[u8]]) -> Option<String> {
    if params.len() < 2 {
        return None;
    }
    let joined = params[1..].join(b";".as_slice());
    String::from_utf8(joined).ok()
}
