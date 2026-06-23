import Foundation

/// Locates bundled runtime resources (zmx, ghostty shell-integration) inside the
/// app bundle's `Contents/Resources`, and builds the terminal command.
enum AppResources {
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

    /// The command ghostty execs: `env … zmx attach <session>`.
    ///
    /// The environment is set inline with `/usr/bin/env` (not ghostty's `env`
    /// config, which doesn't reach the spawned shell here): `-u …` clears any
    /// inherited zmx session vars (else `attach` targets the wrong session),
    /// `ZMX_DIR` isolates the session, and the `GHOSTTY_*`/`ZDOTDIR` vars
    /// activate ghostty's zsh shell integration through zmx.
    ///
    /// Paths are double-quoted: ghostty runs this through `bash -c`/`/bin/sh -c`,
    /// so shell quoting handles spaces in the bundle path or `$TMPDIR`.
    static var terminalCommand: String {
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
        parts += ["\"\(zmx)\"", "attach", "piyo-main"]
        return parts.joined(separator: " ")
    }
}
