import SwiftUI

struct ScaffoldNotice: View {
    var body: some View {
        Label("UI scaffold — configuration not connected", systemImage: "hammer")
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
