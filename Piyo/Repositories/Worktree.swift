import Foundation

/// One worktree of a git repository: its working-directory path and the short
/// name of the branch it has checked out (`"(detached)"` when HEAD isn't a branch).
struct Worktree: Identifiable, Hashable {
    let path: String
    let branch: String
    var id: String { path }
}
