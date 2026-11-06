import SwiftUI

struct RuntimeUpdatesRow: View {
    let state: RuntimeReadiness.Updates

    var body: some View {
        switch state {
        case .notChecked:
            RuntimeCheckRow(item: .upToDate, status: "Not checked")
        case .checking:
            RuntimeCheckRow(item: .upToDate, status: "Checking…")
        case .current(let version):
            RuntimeCheckRow(item: .upToDate, status: "Up to date", detail: version)
        case .available(let installed, let latest):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Update available",
                detail: String(localized: "Installed: \(installed). Available: \(latest).")
            )
        case .development(let version, let published):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Newer than Homebrew",
                detail: String(localized: "Installed: \(version). Published: \(published).")
            )
        case .notInstalled(let latest):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Not installed",
                detail: String(localized: "Homebrew offers Pico \(latest).")
            )
        case .unlinked(let versions):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Not linked",
                detail: String(
                    localized:
                        "Homebrew has Pico \(versions.formatted(.list(type: .and))) installed. Reinstall to restore its command link."
                )
            )
        case .custom(let path, let latest):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Custom executable",
                detail: String(
                    localized:
                        "Homebrew offers Pico \(latest). Pico does not offer package changes for the selected executable at \(path). Open Pico without -PicoExecutable to manage the Homebrew installation."
                )
            )
        case .homebrewUnavailable:
            RuntimeCheckRow(item: .upToDate, status: "Homebrew not found")
        case .homebrewUnsupported(let version):
            RuntimeCheckRow(
                item: .upToDate,
                status: "Homebrew needs updating",
                detail: String(
                    localized:
                        "Homebrew \(version) is installed. Pico requires Homebrew 6 or later."
                )
            )
        case .tapNotTrusted:
            RuntimeCheckRow(
                item: .upToDate,
                status: "Trust required",
                detail: String(localized: "Homebrew requires your permission to use markmals/tap.")
            )
        case .failed(let message):
            RuntimeCheckRow(item: .upToDate, status: "Check failed", detail: message)
        }
    }
}
