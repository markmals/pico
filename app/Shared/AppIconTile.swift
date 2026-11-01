import SwiftUI

/// A destination's icon drawn the way System Settings draws its panes: a white glyph on a
/// colored, continuous-corner square.
struct AppIconTile: View {
    let destination: SettingsDestination
    let size: CGFloat

    var body: some View {
        Image(systemName: destination.symbol)
            .font(.system(size: size * 0.56, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(
                destination.tileColor.gradient,
                in: .rect(cornerRadius: size * 0.24, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}
