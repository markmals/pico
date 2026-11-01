import SwiftUI

/// A settings item's disabled picker whose only choice states that nothing is connected.
struct UnconnectedPicker: View {
    let item: SettingsItem

    var body: some View {
        Picker(selection: .constant(0)) {
            Text("Not connected").tag(0)
        } label: {
            Text(item.title)
        }
        .disabled(true)
        .accessibilityLabel(Text(item.title))
        .settingsRow(item)
    }
}
