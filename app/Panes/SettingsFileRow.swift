import AppKit
import SwiftUI

struct SettingsFileRow: View {
    let settings: ModelSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Text(SettingsItem.settingsFile.displayTitle)
                    .fixedSize()
                Spacer(minLength: 0)
                SettingsValueText(value: value)
                    .layoutPriority(-1)
                ShowSettingsFileButton(path: settings.settingsFile.path)
            }
            if case .failed(let message) = settings.settingsFile {
                Text(verbatim: message)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Try Again") { settings.reload() }
            }
        }
        .accessibilityElement(children: .contain)
        .settingsRow(.settingsFile)
        .contextMenu {
            Button("Copy Path", action: copyPath)
                .disabled(settings.settingsFile.path == nil)
        }
    }

    private var value: SettingsValue {
        switch settings.settingsFile {
        case .loading: .text("Loading…")
        case .known(let path): .verbatim(path)
        case .failed: .text("Unavailable")
        }
    }

    private func copyPath() {
        guard let path = settings.settingsFile.path else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(path, forType: .string)
    }
}
