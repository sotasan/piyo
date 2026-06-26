import SwiftUI

@main
struct PiyoApp: App {
    var body: some Scene {
        WindowGroup("piyo") {
            RootView()
        }
        .defaultSize(width: 800, height: 500)
        .windowResizability(.contentMinSize)
    }
}
