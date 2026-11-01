import SwiftUI

/// The app's own name and purpose, which are fixed rather than loaded.
struct AppIdentityRow: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: "Pico")
                .font(.headline)
            Text("Native configuration for the Pico ACP adapter.")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
