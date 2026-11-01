import SwiftUI

/// The settings item the latest navigation opened. `openCount` distinguishes opening the same
/// item again, which scrolls and focuses it again.
struct SettingsReveal: Equatable {
    let item: SettingsItem
    let openCount: Int
}

extension EnvironmentValues {
    @Entry var settingsReveal: SettingsReveal?
}

extension View {
    /// Marks this row as `item`'s row: the target of scrolling, and outlined while revealed.
    func settingsRow(_ item: SettingsItem) -> some View {
        modifier(SettingsRowModifier(item: item))
    }
}

private struct SettingsRowModifier: ViewModifier {
    let item: SettingsItem

    @AccessibilityFocusState private var isFocused: Bool
    @Environment(\.settingsReveal) private var reveal

    func body(content: Content) -> some View {
        let isRevealed = reveal?.item == item
        content
            .id(item)
            .overlay {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(Color.accentColor, lineWidth: 2)
                    .background(
                        Color.accentColor.opacity(0.12),
                        in: .rect(cornerRadius: 6, style: .continuous)
                    )
                    .padding(-6)
                    .opacity(isRevealed ? 1 : 0)
                    .allowsHitTesting(false)
            }
            .accessibilityFocused($isFocused)
            .onChange(of: reveal, initial: true) { _, reveal in
                if reveal?.item == item {
                    isFocused = true
                }
            }
    }
}
