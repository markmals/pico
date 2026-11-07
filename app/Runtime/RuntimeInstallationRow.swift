import SwiftUI

struct RuntimeInstallationRow<Actions: View>: View {
    let state: RuntimeReadiness.Installation
    @ViewBuilder let actions: Actions

    var body: some View {
        switch state {
        case .unknown:
            RuntimeCheckRow(item: .installed, status: "Not checked") { actions }
        case .checking:
            RuntimeCheckRow(item: .installed, status: "Checking…") { actions }
        case .installed(let path):
            RuntimeCheckRow(item: .installed, status: "Installed", detail: .path(path)) { actions }
        case .missing(let message):
            RuntimeCheckRow(
                item: .installed,
                status: "Not found",
                detail: .explanation("\(message)")
            ) {
                actions
            }
        }
    }
}
