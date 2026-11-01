import SwiftUI

/// The first group of every pane: its icon, title, and what the pane is for.
struct PaneHeader: View {
    let destination: SettingsDestination

    var body: some View {
        Section {
            HStack(alignment: .top, spacing: 12) {
                AppIconTile(destination: destination, size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(destination.title)
                        .font(.headline)
                    Text(destination.summary)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
        }
    }
}
