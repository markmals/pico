import SwiftUI

struct RuntimeStartupRow<Actions: View>: View {
    let state: RuntimeReadiness.Startup
    @ViewBuilder let actions: Actions

    var body: some View {
        switch state {
        case .unknown:
            RuntimeCheckRow(item: .starts, status: "Not checked") { actions }
        case .checking:
            RuntimeCheckRow(item: .starts, status: "Checking…") { actions }
        case .starts(let version):
            RuntimeCheckRow(
                item: .starts,
                status: "Passed",
                detail: .text("Command version: \(version)")
            ) { actions }
        case .failed(let message):
            RuntimeCheckRow(
                item: .starts,
                status: "Failed",
                detail: .error(message),
                isFailure: true
            ) { actions }
        }
    }
}
