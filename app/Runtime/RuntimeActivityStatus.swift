import SwiftUI

struct RuntimeActivityStatus: View {
    let activity: RuntimeReadiness.Activity

    var body: some View {
        HStack(spacing: 8) {
            ProgressView()
            Text(title)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var title: LocalizedStringResource {
        switch activity {
        case .checking: "Checking runtime…"
        case .checkingUpdates: "Checking for updates…"
        case .running(let action): action.progressTitle
        case .stopping: "Stopping commands…"
        }
    }
}
