import SwiftUI

/// A labeled form row for a value this scaffold does not load.
struct UnconnectedValueRow: View {
    let label: LocalizedStringKey

    var body: some View {
        LabeledContent {
            Text("Not connected")
                .foregroundStyle(.secondary)
        } label: {
            Text(label)
        }
    }
}
