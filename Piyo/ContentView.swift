import AppKit
import SwiftUI

struct ContentView: View {
    @State private var store = RepoStore()
    @State private var selection: Worktree?
    @State private var addError: String?

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(store.repos) { repo in
                    DisclosureGroup {
                        ForEach(store.worktrees(for: repo)) { worktree in
                            Label(worktree.branch, systemImage: "arrow.triangle.branch")
                                .tag(worktree)
                        }
                    } label: {
                        Label(repo.name, systemImage: "folder")
                            .contextMenu {
                                Button("Remove", role: .destructive) { store.remove(repo) }
                            }
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 220, max: 320)
            .navigationTitle("piyo")
            .toolbar {
                ToolbarItem(placement: .navigation) {
                    Button(action: addRepo) {
                        Image(systemName: "plus")
                    }
                    .help("Add Repository")
                }
            }
        } detail: {
            if let selection {
                WorktreeTabsView(worktree: selection, store: store)
                    .id(selection.id)
            } else {
                ContentUnavailableView(
                    "No Worktree Selected",
                    systemImage: "sidebar.left",
                    description: Text(
                        store.repos.isEmpty
                            ? "Add a repository with the + button."
                            : "Pick a worktree from the sidebar."
                    )
                )
            }
        }
        .frame(minWidth: 600, minHeight: 400)
        .alert(
            "Couldn't add repository",
            isPresented: Binding(get: { addError != nil }, set: { if !$0 { addError = nil } })
        ) {
            Button("OK") { addError = nil }
        } message: {
            Text(addError ?? "")
        }
    }

    private func addRepo() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Add"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        addError = store.add(folder: url.path)
    }
}

/// The detail pane for a selected worktree: a custom tab strip over the terminals,
/// scoped to this worktree. Custom (not native macOS tabs) so the sidebar stays
/// shared — native tabs are whole windows, each with its own sidebar. All tabs stay
/// mounted (hidden, not removed) so switching keeps each PTY alive. The worktree's
/// branch is the window title (`navigationTitle`); the strip holds the terminals.
struct WorktreeTabsView: View {
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

#Preview {
    ContentView()
}
