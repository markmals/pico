import SwiftUI

/// A read-only row naming a tool and whether the curated policy keeps it.
struct ToolPolicyRow: View {
    let name: LocalizedStringKey
    let status: LocalizedStringKey
    let symbol: String

    var body: some View {
        LabeledContent {
            Text(status)
                .foregroundStyle(.secondary)
        } label: {
            Label(name, systemImage: symbol)
        }
    }
}
