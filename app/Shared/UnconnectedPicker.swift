import SwiftUI

/// A disabled picker whose only choice states that nothing is connected.
struct UnconnectedPicker: View {
    let label: LocalizedStringKey

    var body: some View {
        Picker(label, selection: .constant(0)) {
            Text("Not connected").tag(0)
        }
        .disabled(true)
        .accessibilityLabel(Text(label))
    }
}
