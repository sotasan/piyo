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
        if self.window_focused() {
            return;
        }
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
        if payload.is_empty() {
            return;
        }
        let body = serde_json::from_str::<ClaudeStopPayload>(payload)
            .ok()
            .and_then(|p| p.last_assistant_message)
            .map(|m| strip_markdown(&m))
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| "Task complete".to_string());
        self.notify("Claude Code", &body);
    }

    fn handle_codex_notify(&self, payload: &str) {
        let payload = payload.trim();
        if payload.is_empty() {
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
            .map(|m| strip_markdown(&m))
            .filter(|m| !m.is_empty())
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
            // Title (OSC 0 / 2) is handled by xterm.js natively via
            // term.onTitleChange, so we don't dispatch it here.
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

/// Render a Markdown string down to plain text suitable for an OS notification
/// body. Every text-bearing construct is converted to its content (link text,
/// table cells, inline/block math, list items, …) while the surrounding syntax
/// (emphasis, headings, fences, bullets, link URLs) is dropped.
fn strip_markdown(input: &str) -> String {
    use pulldown_cmark::{Event, Options, Parser, TagEnd};

    // Enable every extension so all Markdown features are recognised and
    // flattened, except the ones that would *hide* text rather than convert it:
    // metadata blocks swallow leading content, and the legacy footnote syntax
    // conflicts with ENABLE_FOOTNOTES.
    let options = Options::all()
        - Options::ENABLE_OLD_FOOTNOTES
        - Options::ENABLE_YAML_STYLE_METADATA_BLOCKS
        - Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS;

    let mut out = String::new();
    for event in Parser::new_ext(input, options) {
        match event {
            Event::Text(t) | Event::Code(t) | Event::InlineMath(t) | Event::DisplayMath(t) => {
                out.push_str(&t)
            }
            Event::SoftBreak => out.push(' '),
            // Keep table columns visually separated within a row.
            Event::End(TagEnd::TableCell) => out.push('\t'),
            Event::HardBreak
            | Event::Rule
            | Event::End(
                TagEnd::Paragraph
                | TagEnd::Heading(_)
                | TagEnd::Item
                | TagEnd::TableRow
                | TagEnd::TableHead
                | TagEnd::DefinitionListTitle
                | TagEnd::DefinitionListDefinition,
            ) => out.push('\n'),
            _ => {}
        }
    }

    // Drop the trailing cell/line separators each block leaves behind.
    out.lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
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

#[cfg(test)]
mod tests {
    use super::strip_markdown;

    #[test]
    fn keeps_plain_text_unchanged() {
        assert_eq!(strip_markdown("plain text"), "plain text");
    }

    #[test]
    fn drops_emphasis_markers() {
        assert_eq!(strip_markdown("*italic* and **bold**"), "italic and bold");
    }

    #[test]
    fn drops_heading_markers() {
        assert_eq!(strip_markdown("# Heading"), "Heading");
    }

    #[test]
    fn keeps_inline_code_content() {
        assert_eq!(
            strip_markdown("Here is `code` inline"),
            "Here is code inline"
        );
    }

    #[test]
    fn keeps_link_text_drops_url() {
        assert_eq!(
            strip_markdown("[Anthropic](https://anthropic.com)"),
            "Anthropic"
        );
    }

    #[test]
    fn flattens_list_items_to_lines() {
        assert_eq!(strip_markdown("- one\n- two"), "one\ntwo");
    }

    #[test]
    fn collapses_paragraph_breaks() {
        assert_eq!(
            strip_markdown("Line one.\n\nLine two."),
            "Line one.\nLine two."
        );
    }

    #[test]
    fn preserves_fenced_code_content() {
        assert_eq!(strip_markdown("```\nlet x = 1;\n```"), "let x = 1;");
    }

    #[test]
    fn drops_strikethrough_markers() {
        assert_eq!(strip_markdown("~~struck~~ through"), "struck through");
    }

    #[test]
    fn drops_task_list_markers() {
        assert_eq!(strip_markdown("- [ ] todo\n- [x] done"), "todo\ndone");
    }

    #[test]
    fn flattens_table_to_tab_separated_rows() {
        assert_eq!(
            strip_markdown("| a | b |\n|---|---|\n| 1 | 2 |"),
            "a\tb\n1\t2"
        );
    }

    #[test]
    fn keeps_link_text_inside_table_cells() {
        assert_eq!(
            strip_markdown("| col |\n|---|\n| [Anthropic](https://anthropic.com) |"),
            "col\nAnthropic"
        );
    }

    #[test]
    fn keeps_math_content() {
        assert_eq!(strip_markdown("Euler: $a + b$"), "Euler: a + b");
    }

    #[test]
    fn empty_input_is_empty() {
        assert_eq!(strip_markdown(""), "");
    }
}
