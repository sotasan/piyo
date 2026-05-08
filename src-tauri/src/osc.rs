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

    fn handle_title(&self, params: &[&[u8]]) {
        if let Some(title) = join_payload(params, 1) {
            let _ = self.app.emit("pty:title", &title);
        }
    }

    fn handle_iterm2_notify(&self, params: &[&[u8]]) {
        if subcommand(params) == Some(b"4".as_slice()) {
            return;
        }
        if let Some(msg) = join_payload(params, 1) {
            self.notify("Piyo", &msg);
        }
    }

    fn handle_xterm_notify(&self, params: &[&[u8]]) {
        if subcommand(params) != Some(b"notify".as_slice()) {
            return;
        }
        let title = params
            .get(2)
            .and_then(|t| std::str::from_utf8(t).ok())
            .filter(|t| !t.is_empty())
            .unwrap_or("Piyo");
        let body = join_payload(params, 3).unwrap_or_default();
        self.notify(title, &body);
    }

    fn handle_claude_stop(&self, params: &[&[u8]]) {
        if self.window_focused() {
            return;
        }
        let Some(json) = join_payload(params, 1) else {
            return;
        };
        let body = serde_json::from_str::<serde_json::Value>(&json)
            .ok()
            .and_then(|v| {
                v.get("last_assistant_message")
                    .and_then(|m| m.as_str())
                    .map(String::from)
            })
            .unwrap_or_else(|| "Task complete".to_string());
        self.notify("Claude Code", &body);
    }
}

impl Perform for OscPerformer {
    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        let Some(&code) = params.first() else { return };
        match code {
            b"0" | b"2" => self.handle_title(params),
            b"9" => self.handle_iterm2_notify(params),
            b"777" => self.handle_xterm_notify(params),
            b"74961" => self.handle_claude_stop(params),
            _ => {}
        }
    }
}

fn subcommand<'a>(params: &[&'a [u8]]) -> Option<&'a [u8]> {
    params.get(1).copied()
}

fn join_payload(params: &[&[u8]], from: usize) -> Option<String> {
    if params.len() <= from {
        return None;
    }
    String::from_utf8(params[from..].join(b";".as_slice())).ok()
}
