use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use vte::Perform;

pub struct OscPerformer {
    app: AppHandle,
    pty_id: u64,
    cwd: Arc<Mutex<Option<PathBuf>>>,
}

#[derive(Clone, serde::Serialize)]
struct TitleEvent<'a> {
    id: u64,
    title: &'a str,
}

#[derive(Clone, serde::Serialize)]
struct CwdEvent<'a> {
    id: u64,
    cwd: &'a str,
}

impl OscPerformer {
    pub fn new(app: AppHandle, pty_id: u64, cwd: Arc<Mutex<Option<PathBuf>>>) -> Self {
        Self { app, pty_id, cwd }
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
        if let ("claude", "stop") = (name, subcommand) {
            self.handle_claude_stop(payload);
        }
    }

    fn handle_claude_stop(&self, payload: &str) {
        let payload = payload.trim();
        if payload.is_empty() || self.window_focused() {
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

    fn handle_cwd(&self, payload: &str) {
        let Some(path) = parse_file_uri_path(payload) else {
            return;
        };
        if path.is_empty() {
            return;
        }
        let buf = PathBuf::from(&path);
        *self.cwd.lock().unwrap() = Some(buf);
        let _ = self.app.emit(
            "pty:cwd",
            CwdEvent {
                id: self.pty_id,
                cwd: &path,
            },
        );
    }
}

impl Perform for OscPerformer {
    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        let Some(&code) = params.first() else { return };
        match code {
            b"0" | b"2" => {
                if let Some(title) = join_payload(params, 1) {
                    let _ = self.app.emit(
                        "pty:title",
                        TitleEvent {
                            id: self.pty_id,
                            title: &title,
                        },
                    );
                }
            }
            b"7" => {
                if let Some(payload) = join_payload(params, 1) {
                    self.handle_cwd(&payload);
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
                let payload = join_payload(params, 3).unwrap_or_default();
                self.dispatch_agent(&name, &subcommand, &payload);
            }
            _ => {}
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

fn parse_file_uri_path(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://").unwrap_or(uri);
    let path_start = rest.find('/').unwrap_or(0);
    let raw = &rest[path_start..];
    Some(percent_decode(raw))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = hex_val(bytes[i + 1]);
            let lo = hex_val(bytes[i + 2]);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_string())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
