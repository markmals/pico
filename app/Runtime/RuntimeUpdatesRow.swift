import SwiftUI

struct RuntimeUpdatesRow<Actions: View>: View {
    let state: RuntimeReadiness.Updates
    @ViewBuilder let actions: Actions

    var body: some View {
        switch state {
        case .notChecked:
            RuntimeCheckRow(item: .upToDate, status: "Not checked") { actions }
        case .checking:
            RuntimeCheckRow(item: .upToDate, status: "Checking…") { actions }
        case .current(let version):
            RuntimeCheckRow(item: .upToDate, status: "Up to date", detail: .text("Pico \(version)"))
            { actions }
        case .available(let installed, let latest):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Update available",
                detail: .text("Pico \(latest) is available. Installed: \(installed).")
            ) { actions }
        case .development(let version, let published):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Newer than Homebrew",
                detail: .text("Installed: \(version). Published: \(published).")
            ) { actions }
        case .notInstalled(let latest):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Not in Homebrew",
                detail: .text("Homebrew offers Pico \(latest).")
            ) { actions }
        case .unlinked(let versions):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Command link missing",
                detail: .text(
                    "Homebrew has Pico \(versions.formatted(.list(type: .and))) installed. Reinstall to restore its command link."
                )
            ) { actions }
        case .custom(let path, let latest):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Custom executable",
                detail: .explanation(
                    "Homebrew offers Pico \(latest). Pico does not offer package changes for the selected executable at \(path). Open Pico without -PicoExecutable to manage the Homebrew installation."
                )
            ) { actions }
        case .homebrewUnavailable:
            RuntimeCheckRow(item: .upToDate, status: "Homebrew not found") { actions }
        case .homebrewUnsupported(let version):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Homebrew needs updating",
                detail: .text(
                    "Homebrew \(version) is installed. Pico requires Homebrew 6 or later."
                )
            ) { actions }
        case .tapNotTrusted:
            RuntimeCheckRow(
                item: .upToDate,
                status: "Trust required",
                detail: .text("Homebrew requires your permission to use markmals/tap.")
            ) { actions }
        case .failed(let message):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Check failed",
                detail: .error(message),
                isFailure: true
            ) {
                actions
            }
        }
    }
}
