import Foundation

/// Locates bundled runtime resources (zmx, ghostty shell-integration) inside the
/// app bundle's `Contents/Resources`, and builds the command ghostty execs for a
/// worktree's terminal.
enum TerminalCommand {
    /// The app bundle's `Contents/Resources` directory.
    private static var resources: String {
        Bundle.main.resourceURL?.path ?? FileManager.default.currentDirectoryPath
    }

    /// The zmx binary: `PIYO_ZMX` override, the bundled copy, else `zmx` on PATH.
    static var zmx: String {
        if let env = ProcessInfo.processInfo.environment["PIYO_ZMX"], !env.isEmpty {
            return env
        }
        let bundled = "\(resources)/bin/zmx"
        return FileManager.default.isExecutableFile(atPath: bundled) ? bundled : "zmx"
    }

    /// A piyo-private zmx socket dir, so our sessions are isolated from any other
    /// zmx on the machine and our session's shell inherits the env we set below.
    static var zmxDir: String {
        if let env = ProcessInfo.processInfo.environment["PIYO_ZMX_DIR"], !env.isEmpty {
            return env
        }
        return NSTemporaryDirectory() + "piyo-zmx"
    }

    /// `GHOSTTY_RESOURCES_DIR` — the bundle Resources dir holds `shell-integration/`.
    /// nil if the integration scripts aren't present.
    static var ghosttyResourcesDir: String? {
        let marker = "\(resources)/shell-integration/zsh/.zshenv"
        return FileManager.default.isReadableFile(atPath: marker) ? resources : nil
    }

    /// The zmx session name for a terminal session: `piyo-<uuid>`. The session's
    /// UUID (the store's primary key) is used directly — it's already stable and
    /// unique, so the persistent zmx session is reattached across launches with
    /// no hashing. Fits the socket-path limit: `piyo-` + 36-char UUID = 41 bytes.
    static func sessionName(for sessionId: String) -> String { "piyo-\(sessionId)" }

    /// The command ghostty execs for a worktree: `cd <dir> && env … zmx attach <session>`.
    ///
    /// The environment is set inline with `/usr/bin/env` (not ghostty's `env`
    /// config, which doesn't reach the spawned shell here): `-u …` clears any
    /// inherited zmx session vars (else `attach` targets the wrong session),
    /// `ZMX_DIR` isolates the session, and the `GHOSTTY_*`/`ZDOTDIR` vars
    /// activate ghostty's zsh shell integration through zmx. The leading `cd`
    /// only affects a session's first creation; later attaches reuse it.
    ///
    /// Paths are double-quoted: ghostty runs this through `bash -c`/`/bin/sh -c`,
    /// so shell quoting handles spaces in the directory, bundle path, or `$TMPDIR`.
    static func build(directory: String, session: String) -> String {
        var parts = [
            "/usr/bin/env", "-u", "ZMX_SESSION", "-u", "ZMX_SESSION_PREFIX",
            "ZMX_DIR=\"\(zmxDir)\"",
        ]
        if let res = ghosttyResourcesDir {
            parts += [
                "GHOSTTY_RESOURCES_DIR=\"\(res)\"",
                "ZDOTDIR=\"\(res)/shell-integration/zsh\"",
                "GHOSTTY_SHELL_FEATURES=cursor,title",
            ]
        }
        parts += ["\"\(zmx)\"", "attach", session]
        return "cd \"\(directory)\" && \(parts.joined(separator: " "))"
    }
}
