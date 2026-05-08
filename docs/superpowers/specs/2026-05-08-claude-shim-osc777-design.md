# Claude shim + OSC 777 macOS notifications

## Goal

Inside Piyo's terminal, the user wants `claude` to always emit desktop-notification escape sequences so that long-running tasks can surface a macOS notification when Piyo is in the background. Claude Code already supports this via `preferredNotifChannel: "ghostty"`, which emits `OSC 777 ; notify ; <title> ; <body>`. Piyo currently handles `OSC 0/2` (title) and `OSC 9` (iTerm2-style notification) but not `OSC 777`.

The override must be inline (no edits to the user's `~/.claude/settings.json`) and must only fire macOS notifications when Piyo's window is not focused, so foreground use stays quiet.

## Components

### 1. `src-tauri/bin/claude` — POSIX shim

A small `sh` script bundled with the app:

```sh
#!/bin/sh
self_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATH=$(printf '%s\n' "$PATH" | awk -v RS=: -v ORS=: -v skip="$self_dir" '$0 != skip' | sed 's/:$//')
export PATH
exec claude --settings '{"preferredNotifChannel":"ghostty"}' "$@"
```

- Strips its own directory from `PATH` so `exec claude` resolves to the real binary.
- Passes `--settings` with an inline JSON string (Claude Code accepts either a file path or literal JSON).
- Forwards all user args via `"$@"`.
- File mode `755`; the shebang invokes `/bin/sh` so it doesn't depend on a particular shell.

### 2. PATH injection in `src-tauri/src/pty.rs`

`pty_spawn` already resolves `app.path().resource_dir()` to bundle the shell-integration directory. Reuse the same resolved path to compute `<resource_dir>/bin`, and prepend it to the child's `PATH` environment variable inside `apply_common_env` (or a sibling helper that takes the bin dir).

The prepend must:

- Read the inherited `PATH` (`std::env::var("PATH")`), defaulting to a sensible string if missing.
- Place the bin dir first so the shim wins over user-installed `claude`.
- Be applied before `shell.apply_env` so all shells (bash/zsh/fish/other) inherit it.

### 3. OSC 777 handler in `src-tauri/src/osc.rs`

Add a new arm to `osc_dispatch`:

- Match on `b"777"`.
- Require `params.get(1) == Some(&b"notify".as_slice())` so we ignore unrelated subcommands (e.g. zsh's `precmd`/`preexec`).
- Read `params[2]` as the title (UTF-8); fall back to `"Claude"` if absent or empty.
- Join `params[3..]` with `;` for the body (matches existing `join_payload` semantics; bodies may legitimately contain semicolons that VTE will have split).
- Query `self.app.get_webview_window("main").map(|w| w.is_focused().unwrap_or(false)).unwrap_or(false)`. If the window is **not** focused (or not resolvable), emit the notification via the existing `tauri_plugin_notification` builder. If focused, drop silently.

The handler reuses the existing `NotificationExt` plumbing — no new permissions or plugin wiring required.

### 4. Bundling in `src-tauri/tauri.conf.json`

Extend `bundle.resources` from `["shell/**/*"]` to include `bin/**/*`. Tauri's resource copy preserves the executable bit on Unix. The dev `resource_dir` already resolves to a directory under `target/`, so dev runs pick up the same layout as release without extra wiring.

## Data flow

```
claude finishes task
  └─ emits  ESC ] 777 ; notify ; "Title" ; "Body" BEL
       │
       ▼
PTY reader in pty_spawn
  └─ vte::Parser::advance → OscPerformer::osc_dispatch
       │
       ▼
osc.rs:  match "777" → check "notify" → check window focus
       │
       ▼
not focused → tauri_plugin_notification banner
focused     → drop
```

## Error handling

- Shim: if the real `claude` is not on `PATH` after stripping, `exec` fails with the standard `command not found`; we don't try to mask that.
- OSC handler: malformed payloads (missing title) fall back to a default title rather than crashing the parser; non-UTF-8 bytes are dropped (consistent with `join_payload`).
- Focus query: if `get_webview_window("main")` returns `None`, we default to _sending_ the notification — a missing window is the same condition as "not focused" from the user's perspective.

## Out of scope

- No changes to OSC 9 or 0/2 handlers (already correct).
- No new Tauri capability permissions (notification plugin is already wired in `lib.rs`).
- No fish/zsh shell integration changes — the shim works at the binary layer, independent of shell.
- No de-duplication / rate-limiting of notifications.
