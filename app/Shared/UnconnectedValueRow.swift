import SwiftUI

/// A settings item's row whose value this scaffold does not load.
struct UnconnectedValueRow: View {
    let item: SettingsItem

    var body: some View {
        LabeledContent {
            Text("Not connected")
                .foregroundStyle(.secondary)
        } label: {
            Text(item.title)
        }
        .settingsRow(item)
    }
}
