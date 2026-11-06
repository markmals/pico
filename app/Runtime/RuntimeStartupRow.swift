import SwiftUI

struct RuntimeStartupRow: View {
    let state: RuntimeReadiness.Startup

    var body: some View {
        switch state {
        case .unknown:
            RuntimeCheckRow(item: .starts, status: "Not checked")
        case .checking:
            RuntimeCheckRow(item: .starts, status: "Checking…")
        case .starts(let version):
            RuntimeCheckRow(item: .starts, status: "Starts", detail: "pico \(version)")
        case .failed(let message):
            RuntimeCheckRow(item: .starts, status: "Failed", detail: message)
        }
    }
}
