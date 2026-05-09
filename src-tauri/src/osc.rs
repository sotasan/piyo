use tauri::{AppHandle, Emitter, Manager, ResourceId};
use tauri_plugin_notification::NotificationExt;
use vte::Perform;

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
}

impl Perform for OscPerformer {
    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        let Some(&code) = params.first() else { return };
        match code {
            b"0" | b"2" => {
                if let Some(title) = join_payload(params, 1) {
                    let _ = self.app.emit(
                        "pty:title",
                        &serde_json::json!({ "rid": self.rid, "title": title }),
                    );
                }
            }
            b"7" => {
                if let Some(uri) = join_payload(params, 1)
                    && let Some(path) = parse_file_uri(&uri)
                {
                    let _ = self.app.emit(
                        "pty:cwd",
                        &serde_json::json!({ "rid": self.rid, "cwd": path }),
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

/// Parse an OSC 7 `file://host/path` URI into a percent-decoded path string.
///
/// Note: bash/zsh/fish integration scripts emit `$PWD` without percent-
/// encoding, so paths containing literal `%XX` (where XX is a hex pair)
/// will be incorrectly decoded. In practice this is rare on Unix.
/// Nushell paths are properly URI-encoded via `url encode`.
fn parse_file_uri(uri: &str) -> Option<String> {
    let rest = uri.strip_prefix("file://")?;
    // rest = "host/path" — drop everything up to and including the first '/'
    let slash = rest.find('/')?;
    let raw = &rest[slash..];
    Some(percent_decode(raw))
}

fn percent_decode(s: &str) -> String {
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2]))
        {
            out.push((h << 4) | l);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|e| String::from_utf8_lossy(&e.into_bytes()).into_owned())
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_uri() {
        assert_eq!(parse_file_uri("file://host/tmp"), Some("/tmp".into()));
    }

    #[test]
    fn parse_empty_host() {
        assert_eq!(parse_file_uri("file:///tmp"), Some("/tmp".into()));
    }

    #[test]
    fn parse_missing_scheme() {
        assert_eq!(parse_file_uri("/tmp"), None);
    }

    #[test]
    fn parse_no_path() {
        assert_eq!(parse_file_uri("file://host"), None);
    }

    #[test]
    fn parse_percent_encoded() {
        assert_eq!(
            parse_file_uri("file://host/tmp/foo%20bar"),
            Some("/tmp/foo bar".into()),
        );
    }

    #[test]
    fn parse_invalid_percent_passes_through() {
        // %ZZ is not valid hex; parser leaves the bytes as-is
        assert_eq!(
            parse_file_uri("file://host/tmp/%ZZ"),
            Some("/tmp/%ZZ".into()),
        );
    }

    #[test]
    fn parse_trailing_partial_percent() {
        // Insufficient bytes after % — left literal
        assert_eq!(parse_file_uri("file://host/tmp/%2"), Some("/tmp/%2".into()),);
    }

    #[test]
    fn parse_unicode_via_utf8() {
        // %F0%9F%8D%84 = 🍄 (4-byte UTF-8)
        assert_eq!(
            parse_file_uri("file://host/tmp/%F0%9F%8D%84"),
            Some("/tmp/🍄".into()),
        );
    }
}
