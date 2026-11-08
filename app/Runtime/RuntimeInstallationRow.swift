import SwiftUI

/// Where the `pico` command Pico runs was found. Sesh's launch details show the same row, with
/// actions of their own, so both panes always name the same command.
struct RuntimeInstallationRow<Actions: View>: View {
    let item: SettingsItem
    let state: RuntimeReadiness.Installation
    @ViewBuilder let actions: Actions

    var body: some View {
        switch state {
        case .unknown:
            RuntimeCheckRow(item: item, status: "Not checked") { actions }
        case .checking:
            RuntimeCheckRow(item: item, status: "Checking…") { actions }
        case .installed(let path):
            RuntimeCheckRow(item: item, status: "Installed", detail: .path(path)) { actions }
        case .missing(let message):
            RuntimeCheckRow(
                item: item,
                status: "Not found",
                detail: .error(message),
                isFailure: true
            ) {
                actions
            }
        }
    }
}
