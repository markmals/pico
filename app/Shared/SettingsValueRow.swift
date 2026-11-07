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
        // VoiceOver reads a row without an action as one element, “Pico app, Not connected”;
        // a row with a button stays a named group so the button remains its own control.
        // Each branch carries the row's identity itself: applied to a wrapping `Group`, it
        // stopped `pico://` links from scrolling to the row.
        if Action.self == EmptyView.self {
            row
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: item.plainTitle))
                .accessibilityValue(SettingsValueText.text(for: value))
                .accessibilityAddTraits(.isStaticText)
                .settingsRow(item)
        } else {
            row
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(verbatim: item.plainTitle))
                .settingsRow(item)
        }
    }

    private var row: some View {
        LabeledContent {
            HStack(spacing: 12) {
                SettingsValueText(value: value)
                action
            }
        } label: {
            Text(item.displayTitle)
        }
    }
}

extension SettingsValueRow where Action == EmptyView {
    init(item: SettingsItem, value: SettingsValue?) {
        self.init(item: item, value: value) { EmptyView() }
    }
}
