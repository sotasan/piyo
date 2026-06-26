import AppKit
import SwiftUI

/// The repositories → worktrees sidebar: a selectable list with an add-repo
/// button. Add failures flow back to `RootView`'s alert via `addError`.
struct SidebarView: View {
    let store: RepoStore
    @Binding var selection: Worktree?
    @Binding var addError: String?

    var body: some View {
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
                            Button("Remove", role: .destructive) {
                                Task { await store.remove(repo) }
                            }
                        }
                }
            }
            .onMove { source, destination in
                Task { await store.moveRepos(from: source, to: destination) }
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
                .accessibilityLabel("Add Repository")
            }
        }
    }

    private func addRepo() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Add"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { addError = await store.add(folder: url.path) }
    }
}
