use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use vte::Perform;

pub struct OscPerformer {
    app: AppHandle,
}

enum OscSequence {
    Title(String),
    Iterm2Notify(String),
    XtermNotify { title: String, body: String },
    Agent {
        name: String,
        subcommand: String,
        payload: String,
    },
}

impl OscSequence {
    fn parse(params: &[&[u8]]) -> Option<Self> {
        let code = *params.first()?;
        match code {
            b"0" | b"2" => Some(Self::Title(join_payload(params, 1)?)),
            b"9" => {
                if params.get(1).copied() == Some(b"4".as_slice()) {
                    return None;
                }
                Some(Self::Iterm2Notify(join_payload(params, 1)?))
            }
            b"777" => {
                if params.get(1).copied() != Some(b"notify".as_slice()) {
                    return None;
                }
                let title = params
                    .get(2)
                    .and_then(|t| std::str::from_utf8(t).ok())
                    .filter(|t| !t.is_empty())
                    .unwrap_or("Piyo")
                    .to_string();
                let body = join_payload(params, 3).unwrap_or_default();
                Some(Self::XtermNotify { title, body })
            }
            b"7496" => {
                let name = utf8_param(params, 1)?;
                let subcommand = utf8_param(params, 2)?;
                let payload = join_payload(params, 3).unwrap_or_default();
                Some(Self::Agent {
                    name,
                    subcommand,
                    payload,
                })
            }
            _ => None,
        }
    }
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

    fn dispatch_agent(&self, name: &str, subcommand: &str, payload: &str) {
        match (name, subcommand) {
            ("claude", "stop") => self.handle_claude_stop(payload),
            _ => {}
        }
    }

    fn handle_claude_stop(&self, payload: &str) {
        if self.window_focused() {
            return;
        }
        let body = serde_json::from_str::<serde_json::Value>(payload)
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
        let Some(seq) = OscSequence::parse(params) else {
            return;
        };
        match seq {
            OscSequence::Title(title) => {
                let _ = self.app.emit("pty:title", &title);
            }
            OscSequence::Iterm2Notify(message) => {
                self.notify("Piyo", &message);
            }
            OscSequence::XtermNotify { title, body } => {
                self.notify(&title, &body);
            }
            OscSequence::Agent {
                name,
                subcommand,
                payload,
            } => {
                self.dispatch_agent(&name, &subcommand, &payload);
            }
        }
    }
}

fn utf8_param(params: &[&[u8]], idx: usize) -> Option<String> {
    std::str::from_utf8(params.get(idx)?).ok().map(String::from)
}

fn join_payload(params: &[&[u8]], from: usize) -> Option<String> {
    if params.len() <= from {
        return None;
    }
    String::from_utf8(params[from..].join(b";".as_slice())).ok()
}
