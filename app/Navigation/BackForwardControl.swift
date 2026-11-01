import SwiftUI

/// The joined back/forward buttons at the front of the toolbar.
struct BackForwardControl: View {
    let navigator: SettingsNavigator

    var body: some View {
        ControlGroup {
            Button("Back", systemImage: "chevron.left") {
                navigator.goBack()
            }
            .disabled(!navigator.canGoBack)
            .help("Back")

            Button("Forward", systemImage: "chevron.right") {
                navigator.goForward()
            }
            .disabled(!navigator.canGoForward)
            .help("Forward")
        }
        .controlGroupStyle(.navigation)
    }
}
