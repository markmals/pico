import AppKit
import SwiftUI

/// Where a new session would run `intellisense` from, what the last check made of it, and the
/// choices the user has: a different file, Pico's own search, or another check.
struct IntellisenseLocationRow: View {
    let settings: ModelSettings
    let status: IntellisenseStatus

    private static let item = SettingsItem.intellisenseLocation

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent {
                HStack(spacing: 12) {
                    RowStatus(text: statusText, needsAttention: isFailure)
                    actions
                }
            } label: {
                Text(Self.item.displayTitle)
            }
            if let path = displayedPath {
                RuntimeRowDetail.path(path)
            }
            if let problem {
                RuntimeRowDetail.error(problem)
            }
            if let unavailableChoice {
                RuntimeRowDetail.text(unavailableChoice)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: Self.item.plainTitle))
        .settingsRow(Self.item)
    }

    @ViewBuilder
    private var actions: some View {
        Button("Choose…", action: choose)
            .disabled(settings.snapshot == nil)
            .fixedSize()
        if chosenPath != nil {
            Button("Find Automatically") { settings.chooseIntellisensePath(nil) }
                .disabled(settings.snapshot == nil)
                .fixedSize()
        }
        // The check reads the settings file, so it answers for the saved location rather than
        // one still on its way there.
        Button("Check Again") { status.check(for: settings.snapshot?.item.intellisensePath) }
            .disabled(status.isChecking)
            .fixedSize()
    }

    /// The location the user chose, shown from the moment they choose it.
    private var chosenPath: String? {
        settings.displayedDefaults?.intellisensePath
    }

    /// The location a new session would use: the chosen one, or the one the last check
    /// resolved. It stays visible while the next check runs.
    private var displayedPath: String? {
        chosenPath ?? status.outcome?.path
    }

    private var isFailure: Bool {
        guard !status.isChecking, let outcome = status.outcome else { return false }
        switch outcome {
        case .checked(.ready): return false
        case .checked(.missing), .checked(.unusable), .failed: return true
        }
    }

    /// The cause of a location Pico cannot use, or of a check that could not run.
    private var problem: String? {
        guard !status.isChecking, let outcome = status.outcome else { return nil }
        switch outcome {
        case .checked(.ready): return nil
        case .checked(.missing(let problem)), .checked(.unusable(_, let problem)): return problem
        case .failed(let message): return message
        }
    }

    private var statusText: LocalizedStringResource {
        if status.isChecking { return "Checking…" }
        guard let outcome = status.outcome else { return "Not checked" }
        switch outcome {
        case .checked(.ready(_, let version)): return "\(version)"
        case .checked(.missing): return "Not found"
        case .checked(.unusable): return "Can’t be used"
        case .failed: return "Check failed"
        }
    }

    /// Why choosing a location is unavailable. The choice is saved through Pico's settings,
    /// so it waits on the same read Models reports on.
    private var unavailableChoice: LocalizedStringResource? {
        switch settings.state {
        case .failed:
            "Choosing a location needs Pico’s settings, which couldn’t be loaded. Models shows why."
        case .invalid:
            "Choosing a location needs a settings file Pico can read. Models shows the problem."
        case .loading, .ready, .saving:
            nil
        }
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        // The program is often installed into a folder the Finder hides, such as ~/.cargo/bin.
        panel.showsHiddenFiles = true
        panel.message = String(localized: "Choose the intellisense program new sessions run.")
        panel.prompt = String(localized: "Choose")
        if let directory = displayedPath.map({ URL(filePath: $0).deletingLastPathComponent() }) {
            panel.directoryURL = directory
        }
        guard panel.runModal() == .OK, let chosen = panel.url else { return }
        settings.chooseIntellisensePath(chosen.path)
    }
}
