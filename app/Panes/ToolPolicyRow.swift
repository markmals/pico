import SwiftUI

/// A read-only row naming a built-in tool and whether Pico's policy keeps it.
struct ToolPolicyRow: View {
    let isIncluded: Bool
    let item: SettingsItem
    let symbol: String

    var body: some View {
        LabeledContent {
            Text(isIncluded ? "Included" : "Excluded")
                .foregroundStyle(.secondary)
        } label: {
            Label {
                Text(item.title)
            } icon: {
                Image(systemName: symbol)
            }
        }
        .settingsRow(item)
    }
}
