use percent_encoding::percent_decode_str;
use tauri::{AppHandle, Emitter, Manager, ResourceId};
use tauri_plugin_notification::NotificationExt;
use url::Url;
use vte::Perform;

use crate::pty::{EVENT_PTY_CWD, PtyCwd};

pub struct OscPerformer {
    app: AppHandle,
    rid: ResourceId,
}

impl OscPerformer {
    pub fn new(app: AppHandle, rid: ResourceId) -> Self {
        Self { app, rid }
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

    fn dispatch_agent(&self, action: AgentAction, payload: &str) {
        match action {
            AgentAction::ClaudeStop => self.handle_claude_stop(payload),
            AgentAction::CodexNotify => self.handle_codex_notify(payload),
        }
    }

    fn handle_claude_stop(&self, payload: &str) {
        let payload = payload.trim();
        if payload.is_empty() || self.window_focused() {
            return;
        }
        let body = serde_json::from_str::<ClaudeStopPayload>(payload)
            .ok()
            .and_then(|p| p.last_assistant_message)
            .unwrap_or_else(|| "Task complete".to_string());
        self.notify("Claude Code", &body);
    }

    fn handle_codex_notify(&self, payload: &str) {
        let payload = payload.trim();
        if payload.is_empty() || self.window_focused() {
            return;
        }
        let Ok(parsed) = serde_json::from_str::<CodexNotifyPayload>(payload) else {
            return;
        };
        if parsed.kind != CodexNotifyKind::AgentTurnComplete {
            return;
        }
        let body = parsed
            .last_assistant_message
            .unwrap_or_else(|| "Task complete".to_string());
        self.notify("OpenAI Codex", &body);
    }
}

#[derive(serde::Deserialize)]
struct ClaudeStopPayload {
    last_assistant_message: Option<String>,
}

#[derive(serde::Deserialize)]
struct CodexNotifyPayload {
    #[serde(rename = "type")]
    kind: CodexNotifyKind,
    #[serde(rename = "last-assistant-message")]
    last_assistant_message: Option<String>,
}

#[derive(serde::Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum CodexNotifyKind {
    AgentTurnComplete,
    #[serde(other)]
    Other,
}

impl Perform for OscPerformer {
    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        let Some(&code) = params.first() else { return };
        match code {
            // Title (OSC 0 / 2) is tracked by ghostty via Terminal::on_title_changed
            // in crate::vt, so we don't double-emit it here.
            b"7" => {
                if let Some(uri) = join_payload(params, 1)
                    && let Some(path) = parse_file_uri(&uri)
                {
                    let _ = self.app.emit(
                        EVENT_PTY_CWD,
                        PtyCwd {
                            rid: self.rid,
                            cwd: path,
                        },
                    );
                }
            }
            b"9" => {
                if params.get(1) == Some(&b"4".as_slice()) {
                    return;
                }
                if let Some(msg) = join_payload(params, 1) {
                    self.notify("Piyo", &msg);
                }
            }
            b"777" => {
                if params.get(1) != Some(&b"notify".as_slice()) {
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
            b"7496" => {
                let Some(name) = utf8_param(params, 1) else {
                    return;
                };
                let Some(subcommand) = utf8_param(params, 2) else {
                    return;
                };
                let Some(action) = AgentAction::parse(&name, &subcommand) else {
                    return;
                };
                let payload = join_payload(params, 3).unwrap_or_default();
                self.dispatch_agent(action, &payload);
            }
            _ => {}
        }
    }
}

enum AgentAction {
    ClaudeStop,
    CodexNotify,
}

impl AgentAction {
    fn parse(name: &str, subcommand: &str) -> Option<Self> {
        match (name, subcommand) {
            ("claude", "stop") => Some(Self::ClaudeStop),
            ("codex", "notify") => Some(Self::CodexNotify),
            _ => None,
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

fn parse_file_uri(uri: &str) -> Option<String> {
    let url = Url::parse(uri).ok()?;
    if url.scheme() != "file" {
        return None;
    }
    let path = url.path();
    if path.is_empty() {
        return None;
    }
    Some(percent_decode_str(path).decode_utf8_lossy().into_owned())
}
