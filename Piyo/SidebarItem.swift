import Foundation

/// The selectable destinations shown in the app's sidebar.
enum SidebarItem: String, CaseIterable, Identifiable, Hashable {
    case home
    case terminal
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: "Home"
        case .terminal: "Terminal"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .home: "house"
        case .terminal: "terminal"
        case .settings: "gearshape"
        }
    }
}
