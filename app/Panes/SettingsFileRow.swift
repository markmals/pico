import AppKit
import SwiftUI

struct SettingsFileRow: View {
    let settings: ModelSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LabeledContent {
                HStack(spacing: 12) {
                    switch settings.settingsFile {
                    case .loading:
                        Text("Loading…")
                            .foregroundStyle(.secondary)
                        ShowSettingsFileButton(path: nil)
                    case .known(let path):
                        ShowSettingsFileButton(path: path)
                    case .failed:
                        Label("Couldn’t load", systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.secondary)
                        Button("Try Again") { settings.reload() }
                    }
                }
            } label: {
                Text(SettingsItem.settingsFile.displayTitle)
            }
            if case .known(let path) = settings.settingsFile {
                SettingsValueText(value: .verbatim(path))
                    .font(.caption)
                    .textSelection(.enabled)
            }
            if case .failed(let message) = settings.settingsFile {
                CommandErrorDetails(message: message)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(SettingsItem.settingsFile.displayTitle))
        .settingsRow(.settingsFile)
        .contextMenu {
            Button("Copy Path", action: copyPath)
                .disabled(settings.settingsFile.path == nil)
        }
    }

    private func copyPath() {
        guard let path = settings.settingsFile.path else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(path, forType: .string)
    }
}
