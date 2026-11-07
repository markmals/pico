import SwiftUI

/// What a settings row shows as its value.
enum SettingsValue {
    case text(LocalizedStringResource)
    /// A value shown exactly as written, such as a path, version, or account address.
    case verbatim(String)
}

/// A row's value, or “Not connected” when there is none to show.
struct SettingsValueText: View {
    let value: SettingsValue?

    /// The words a row shows for `value`, which are also what VoiceOver reads as its value.
    static func text(for value: SettingsValue?) -> Text {
        switch value {
        case nil: Text("Not connected")
        case .text(let text): Text(text)
        case .verbatim(let text): Text(verbatim: text)
        }
    }

    var body: some View {
        let text = Self.text(for: value).foregroundStyle(.secondary)
        if case .verbatim(let raw) = value {
            text
                .lineLimit(1)
                .truncationMode(.middle)
                .help(raw)
        } else {
            text
        }
    }
}
