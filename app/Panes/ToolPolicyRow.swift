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
                    .frame(width: 20)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: item.plainTitle))
        .accessibilityValue(isIncluded ? Text("Included") : Text("Excluded"))
        .accessibilityAddTraits(.isStaticText)
        .settingsRow(item)
    }
}
