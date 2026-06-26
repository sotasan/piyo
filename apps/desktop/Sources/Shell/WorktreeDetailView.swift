import SwiftUI

/// The detail pane for a selected worktree: a custom tab strip over the terminals,
/// scoped to this worktree. Custom (not native macOS tabs) so the sidebar stays
/// shared — native tabs are whole windows, each with its own sidebar. All tabs
/// stay mounted (hidden, not removed) so switching keeps each PTY alive. Each tab
/// is a persisted session whose UUID names its zmx session; the worktree's branch
/// is the window title.
struct WorktreeDetailView: View {
    let worktree: Worktree
    let store: RepoStore
    @State private var selected: String?

    var body: some View {
        let sessions = store.sessions(for: worktree)
        let active =
            selected.flatMap { id in sessions.contains { $0.id == id } ? id : nil }
                ?? sessions.first?.id
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(Array(sessions.enumerated()), id: \.element.id) { index, session in
                    tab(
                        session: session, number: index + 1,
                        active: session.id == active, closable: sessions.count > 1,
                    )
                }
                Button {
                    Task { selected = await store.addSession(to: worktree)?.id }
                } label: {
                    Image(systemName: "plus").frame(width: 34, height: 28).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .help("New Tab")
                .accessibilityLabel("New Tab")
                Spacer(minLength: 0)
            }
            .background(.bar)
            Divider()
            ZStack {
                ForEach(sessions) { session in
                    TerminalPane(worktree: worktree, sessionId: session.id)
                        .id(session.id)
                        .opacity(session.id == active ? 1 : 0)
                        .allowsHitTesting(session.id == active)
                }
            }
        }
        .navigationTitle(worktree.branch)
        .task { await store.ensureSession(for: worktree) }
    }

    private func tab(session: Session, number: Int, active: Bool, closable: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "terminal")
            Text("Terminal \(number)")
            if closable {
                Button {
                    if selected == session.id { selected = nil }
                    Task { await store.closeSession(session) }
                } label: {
                    Image(systemName: "xmark").font(.caption2)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close Tab")
            }
        }
        .font(.callout)
        .lineLimit(1)
        .foregroundStyle(active ? .primary : .secondary)
        .padding(.horizontal, 12)
        .frame(height: 28)
        .background(active ? Color(nsColor: .textBackgroundColor) : .clear)
        .contentShape(.rect)
        .onTapGesture { selected = session.id }
    }
}
