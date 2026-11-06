import SwiftUI

struct RuntimeCheckRow: View {
    let item: SettingsItem
    let status: LocalizedStringResource
    var detail: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(item.displayTitle)
                Spacer()
                Text(status)
                    .foregroundStyle(.secondary)
            }
            if let detail {
                Text(verbatim: detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .settingsRow(item)
    }
}
