import SwiftUI

@main
struct PrototypeApp: App {
    var body: some Scene {
        WindowGroup {
            PrototypeRoot()
        }
        #if os(macOS)
        .defaultSize(width: 1180, height: 800)
        #endif
    }
}
