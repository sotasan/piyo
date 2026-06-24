import SwiftUI

/// The detail pane for a selected worktree: a custom tab strip over the terminals,
/// scoped to this worktree. Custom (not native macOS tabs) so the sidebar stays
/// shared — native tabs are whole windows, each with its own sidebar. All tabs
/// stay mounted (hidden, not removed) so switching keeps each PTY alive. The
/// worktree's branch is the window title; the strip holds the terminals.
struct WorktreeDetailView: View {
    let worktree: Worktree
    let store: RepoStore
    @State private var selected: Int?

    var body: some View {
        let ids = store.tabs(for: worktree)
        let active = selected.flatMap { ids.contains($0) ? $0 : nil } ?? ids.first ?? 0
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(Array(ids.enumerated()), id: \.element) { index, id in
                    tab(id: id, number: index + 1, active: id == active, closable: ids.count > 1)
                }
                Button {
                    selected = store.addTab(to: worktree)
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
                ForEach(ids, id: \.self) { id in
                    TerminalPane(worktree: worktree, tab: id)
                        .id(id)
                        .opacity(id == active ? 1 : 0)
                        .allowsHitTesting(id == active)
                }
            }
        }
        .navigationTitle(worktree.branch)
    }

    private func tab(id: Int, number: Int, active: Bool, closable: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "terminal")
            Text("Terminal \(number)")
            if closable {
                Button {
                    if selected == id { selected = nil }
                    store.closeTab(id, from: worktree)
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
        .onTapGesture { selected = id }
    }
}
