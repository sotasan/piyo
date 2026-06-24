import GhosttyTerminal
import SwiftUI

/// A live terminal for one tab of a worktree. ghostty's `.exec` backend owns the
/// PTY; its `command` runs the shell inside a persistent zmx session (survives app
/// restarts) `cd`'d into the worktree — see `AppResources.terminalCommand`. The
/// branch/tab chrome lives in `WorktreeTabsView`; this is just the surface.
struct TerminalPane: View {
    @StateObject private var terminal: TerminalViewState

    init(worktree: Worktree, tab: Int) {
        let command = AppResources.terminalCommand(
            directory: worktree.path,
            session: AppResources.sessionName(for: worktree.path, tab: tab)
        )
        _terminal = StateObject(
            wrappedValue: TerminalViewState(
                terminalConfiguration: .init { builder in
                    builder.withCustom("command", command)
                }
            )
        )
    }

    var body: some View {
        TerminalSurfaceView(context: terminal)
    }
}
