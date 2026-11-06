import SwiftUI

struct RuntimeActivityStatus: View {
    let activity: RuntimeReadiness.Activity

    var body: some View {
        switch activity {
        case .checking:
            ProgressView("Checking runtime…")
        case .checkingUpdates:
            ProgressView("Refreshing Homebrew…")
        case .running(let action):
            ProgressView(action.title)
        case .stopping:
            ProgressView("Stopping commands…")
        }
    }
}
