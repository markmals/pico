import AppKit
import SwiftUI

/// The settings file's location, with Show in Finder and, on right-click, Copy Path. Both are
/// unavailable while settings are unconnected.
struct SettingsFileRow: View {
    let path: String?

    var body: some View {
        SettingsValueRow(item: .settingsFile, value: path.map(SettingsValue.verbatim)) {
            Button("Show in Finder", action: showFolder)
                .disabled(!canShowFolder)
        }
        .contextMenu {
            Button("Copy Path", action: copyPath)
                .disabled(path == nil)
        }
    }

    /// Pico's own folder in Application Support, which holds the settings file.
    private var folder: URL {
        URL.applicationSupportDirectory.appending(path: "Pico", directoryHint: .isDirectory)
    }

    private var canShowFolder: Bool {
        guard path != nil else { return false }
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory)
            && isDirectory.boolValue
    }

    private func showFolder() {
        NSWorkspace.shared.open(folder)
    }

    private func copyPath() {
        guard let path else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(path, forType: .string)
    }
}
