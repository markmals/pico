import AppKit
import SwiftUI

struct SettingsFileRow: View {
    let path: String?
    let isLoading: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text(SettingsItem.settingsFile.displayTitle)
                .fixedSize()
            Spacer(minLength: 0)
            SettingsValueText(
                value: path.map(SettingsValue.verbatim)
                    ?? .text(isLoading ? "Loading…" : "Unavailable")
            )
            .layoutPriority(-1)
            ShowSettingsFileButton(path: path)
        }
        .accessibilityElement(children: .contain)
        .settingsRow(.settingsFile)
        .contextMenu {
            Button("Copy Path", action: copyPath)
                .disabled(path == nil)
        }
    }

    private func copyPath() {
        guard let path else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(path, forType: .string)
    }
}
