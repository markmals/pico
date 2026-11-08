import AppKit
import SwiftUI

/// The path to give Sesh: the command Pico itself runs, as found rather than resolved, so a
/// Homebrew link that survives upgrades is not replaced by the versioned folder behind it.
struct PicoLocationRow: View {
    let installation: RuntimeReadiness.Installation

    var body: some View {
        RuntimeInstallationRow(item: .helperLocation, state: installation) {
            Button("Copy Path", action: copyPath)
                .disabled(path == nil)
                .fixedSize()
            ShowInFinderButton(path: path)
        }
    }

    private var path: String? {
        guard case .installed(let path) = installation else { return nil }
        return path
    }

    private func copyPath() {
        guard let path else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(path, forType: .string)
    }
}
