import SwiftUI

/// A settings item's row: its value, or “Not connected” without one, and an optional action.
struct SettingsValueRow<Action: View>: View {
    let item: SettingsItem
    let value: SettingsValue?
    @ViewBuilder let action: Action

    init(item: SettingsItem, value: SettingsValue?, @ViewBuilder action: () -> Action) {
        self.item = item
        self.value = value
        self.action = action()
    }

    var body: some View {
        LabeledContent {
            HStack(spacing: 12) {
                SettingsValueText(value: value)
                action
            }
        } label: {
            Text(item.title)
        }
        .settingsRow(item)
    }
}

extension SettingsValueRow where Action == EmptyView {
    init(item: SettingsItem, value: SettingsValue?) {
        self.init(item: item, value: value) { EmptyView() }
    }
}
