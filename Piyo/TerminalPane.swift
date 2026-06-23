import GhosttyTerminal
import SwiftUI

/// A live terminal. ghostty's `.exec` backend owns the PTY; its `command` runs
/// the shell inside an isolated, persistent zmx session (survives app restarts)
/// with ghostty's zsh shell integration activated — see
/// `AppResources.terminalCommand`.
struct TerminalPane: View {
    @StateObject private var terminal = TerminalViewState(
        terminalConfiguration: .init { builder in
            builder.withCustom("command", AppResources.terminalCommand)
        }
    )

    var body: some View {
        TerminalSurfaceView(context: terminal)
            .navigationTitle(terminal.title.isEmpty ? "Terminal" : terminal.title)
    }
}
