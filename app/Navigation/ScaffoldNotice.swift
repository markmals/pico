import SwiftUI

struct ScaffoldNotice: View {
    @Environment(\.sampleSettings) private var sample

    var body: some View {
        notice
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

    @ViewBuilder private var notice: some View {
        if sample == nil {
            Label("UI scaffold — configuration not connected", systemImage: "hammer")
        } else {
            Label("Sample data — nothing here is saved or connected", systemImage: "theatermasks")
        }
    }
}
