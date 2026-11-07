import SwiftUI

/// The bar below a pane whose settings are not connected yet.
struct ScaffoldNotice: View {
    var body: some View {
        Label("Some settings aren’t connected yet", systemImage: "hammer")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(.bar)
            .overlay(alignment: .top) {
                Divider()
            }
            .accessibilityElement(children: .combine)
    }
}
