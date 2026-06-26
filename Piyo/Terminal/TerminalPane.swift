import GhosttyTerminal
import SwiftUI

/// A live terminal for one tab of a worktree. ghostty's `.exec` backend owns the
/// PTY; its `command` runs the shell inside a persistent zmx session (survives app
/// restarts) `cd`'d into the worktree — see `TerminalCommand`. The branch/tab
/// chrome lives in `WorktreeDetailView`; this is just the surface.
struct TerminalPane: View {
    @StateObject private var terminal: TerminalViewState

    init(worktree: Worktree, sessionId: String) {
        let command = TerminalCommand.build(
            directory: worktree.path,
            session: TerminalCommand.sessionName(for: sessionId),
        )
        _terminal = StateObject(
            wrappedValue: TerminalViewState(
                terminalConfiguration: .init { builder in
                    builder.withCustom("command", command)
                },
            ),
        )
    }

    var body: some View {
        TerminalSurfaceView(context: terminal)
    }
}
