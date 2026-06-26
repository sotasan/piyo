import Sparkle
import SwiftUI

@main
struct PiyoApp: App {
    // startingUpdater: true → reads SUFeedURL/SUPublicEDKey from Info.plist and runs scheduled checks.
    private let updaterController = SPUStandardUpdaterController(
        startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil,
    )

    var body: some Scene {
        WindowGroup("piyo") {
            RootView()
        }
        .defaultSize(width: 800, height: 500)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(after: .appInfo) {
                // ponytail: no reactive .disabled() — checkForUpdates() no-ops when a check is in flight.
                Button("Check for Updates…") { updaterController.updater.checkForUpdates() }
            }
        }
    }
}
