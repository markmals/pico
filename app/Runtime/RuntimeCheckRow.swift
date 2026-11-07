import SwiftUI

struct RuntimeCheckRow<Actions: View>: View {
    let item: SettingsItem
    let status: LocalizedStringResource
    var detail: RuntimeRowDetail?
    var isFailure = false
    @ViewBuilder let actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent {
                HStack(spacing: 12) {
                    HStack(spacing: 4) {
                        if isFailure {
                            Image(systemName: "exclamationmark.triangle")
                                .accessibilityHidden(true)
                        }
                        Text(status)
                    }
                    .foregroundStyle(.secondary)
                    actions
                }
            } label: {
                Text(item.displayTitle)
            }
            detail
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(item.displayTitle))
        .settingsRow(item)
    }
}
