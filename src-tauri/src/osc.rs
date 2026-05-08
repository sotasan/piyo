use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use vte::Perform;

pub struct OscPerformer {
    app: AppHandle,
}

impl OscPerformer {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }

    fn notify(&self, title: &str, body: &str) {
        let _ = self
            .app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }

    fn window_focused(&self) -> bool {
        self.app
            .get_webview_window("main")
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false)
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
                    self.notify("Piyo", &msg);
                }
            }
            b"777" => {
                if params.get(1).copied() != Some(b"notify".as_slice()) {
                    return;
                }
                if self.window_focused() {
                    return;
                }
                let title = params
                    .get(2)
                    .and_then(|t| std::str::from_utf8(t).ok())
                    .filter(|t| !t.is_empty())
                    .unwrap_or("Claude");
                let body = if params.len() > 3 {
                    let joined = params[3..].join(b";".as_slice());
                    String::from_utf8(joined).unwrap_or_default()
                } else {
                    String::new()
                };
                self.notify(title, &body);
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
