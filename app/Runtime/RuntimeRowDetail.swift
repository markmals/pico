import SwiftUI

enum RuntimeRowDetail: View {
    case text(LocalizedStringResource)
    case path(String)
    case error(String)
    case explanation(LocalizedStringResource)

    var body: some View {
        switch self {
        case .text(let text):
            Text(text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        case .path(let path):
            SettingsValueText(value: .verbatim(path))
                .font(.caption)
                .textSelection(.enabled)
        case .error(let message):
            CommandErrorDetails(message: message)
        case .explanation(let text):
            DisclosureGroup("Details") {
                Text(text)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 12)
            }
        }
    }
}
