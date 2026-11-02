import SwiftUI

/// A settings item's disabled picker whose only choice says why nothing can be chosen.
struct UnavailablePicker: View {
    let item: SettingsItem
    var reason: LocalizedStringResource = "Not connected"

    var body: some View {
        Picker(selection: .constant(0)) {
            Text(reason).tag(0)
        } label: {
            Text(item.displayTitle)
        }
        .disabled(true)
        .accessibilityLabel(Text(item.displayTitle))
        .settingsRow(item)
    }
}
