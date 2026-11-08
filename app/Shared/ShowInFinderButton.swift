import AppKit
import SwiftUI

struct ShowInFinderButton: View {
    let path: String?

    var body: some View {
        Button("Show in Finder…", action: reveal)
            .disabled(target == nil)
            .fixedSize()
    }

    private var target: URL? {
        guard let path else { return nil }
        let file = URL(filePath: path)
        if FileManager.default.fileExists(atPath: file.path) { return file }
        let folder = file.deletingLastPathComponent()
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory),
            isDirectory.boolValue
        else { return nil }
        return folder
    }

    private func reveal() {
        guard let target, let path else { return }
        if target.path == path {
            NSWorkspace.shared.activateFileViewerSelecting([target])
        } else {
            NSWorkspace.shared.open(target)
        }
    }
}
