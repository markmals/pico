import SwiftUI

/// Words about a state that needs the user's attention, led by macOS's caution symbol.
struct CautionLabel: View {
    let text: Text

    init(_ title: LocalizedStringResource) {
        text = Text(title)
    }

    init(_ text: Text) {
        self.text = text
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            CautionSymbol()
            text
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The caution symbol in its system colors. The words beside it carry the meaning, so it adds
/// emphasis for sighted people and stays silent for VoiceOver.
struct CautionSymbol: View {
    var body: some View {
        Image(systemName: "exclamationmark.triangle.fill")
            .symbolRenderingMode(.multicolor)
            .accessibilityHidden(true)
    }
}
