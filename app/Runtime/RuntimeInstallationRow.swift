import SwiftUI

struct RuntimeInstallationRow: View {
    let state: RuntimeReadiness.Installation

    var body: some View {
        switch state {
        case .unknown:
            RuntimeCheckRow(item: .installed, status: "Not checked")
        case .checking:
            RuntimeCheckRow(item: .installed, status: "Checking…")
        case .installed(let path):
            RuntimeCheckRow(item: .installed, status: "Installed", detail: path)
        case .missing(let message):
            RuntimeCheckRow(item: .installed, status: "Not installed", detail: message)
        }
    }
}
