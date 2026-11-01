import SwiftUI

/// What a settings row shows as its value.
enum SettingsValue {
    case text(LocalizedStringResource)
    /// A value shown exactly as written, such as a path, version, or account address.
    case verbatim(String)
    case status(LocalizedStringResource, StatusTone)
}

/// How a status reads at a glance. Its text always says the same thing, so color is never the
/// only signal.
enum StatusTone {
    case ready
    case attention
    case inactive

    fileprivate var symbol: String {
        switch self {
        case .ready: "checkmark.circle.fill"
        case .attention: "exclamationmark.triangle.fill"
        case .inactive: "minus.circle.fill"
        }
    }

    fileprivate var color: Color {
        switch self {
        case .ready: .green
        case .attention: .orange
        case .inactive: .secondary
        }
    }
}

/// A row's value, or “Not connected” when there is none to show.
struct SettingsValueText: View {
    let value: SettingsValue?

    var body: some View {
        switch value {
        case nil:
            Text("Not connected")
                .foregroundStyle(.secondary)
        case .text(let text):
            Text(text)
                .foregroundStyle(.secondary)
        case .verbatim(let text):
            Text(verbatim: text)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
        case .status(let text, let tone):
            HStack(spacing: 4) {
                Image(systemName: tone.symbol)
                    .foregroundStyle(tone.color)
                    .accessibilityHidden(true)
                Text(text)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
