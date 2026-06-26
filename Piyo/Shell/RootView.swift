import SwiftUI

/// The app shell: a sidebar of repos/worktrees beside the selected worktree's
/// terminals. Owns the selection and the add-repo error surfaced as an alert.
struct RootView: View {
    @State private var store = RepoStore()
    @State private var selection: Worktree?
    @State private var addError: String?

    var body: some View {
        NavigationSplitView {
            SidebarView(store: store, selection: $selection, addError: $addError)
        } detail: {
            if let selection {
                WorktreeDetailView(worktree: selection, store: store)
                    .id(selection.id)
            } else {
                let hint: LocalizedStringKey =
                    store.repos.isEmpty
                    ? "Add a repository with the + button."
                    : "Pick a worktree from the sidebar."
                ContentUnavailableView(
                    "No Worktree Selected",
                    systemImage: "sidebar.left",
                    description: Text(hint)
                )
            }
        }
        .frame(minWidth: 600, minHeight: 400)
        .task { await store.start() }
        .alert(
            "Couldn't add repository",
            isPresented: Binding(get: { addError != nil }, set: { if !$0 { addError = nil } })
        ) {
            Button("OK") { addError = nil }
        } message: {
            Text(addError ?? "")  // already localized by RepoStore.add
        }
    }
}
