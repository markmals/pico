import SwiftUI

/// A destination's icon drawn the way System Settings draws its panes: a white glyph on a
/// colored, continuous-corner square.
struct AppIconTile: View {
    let destination: SettingsDestination
    let size: CGFloat

    var body: some View {
        // Fitting each glyph into the same inset box keeps wide and tall symbols from
        // touching the tile's edges, as System Settings' icons don't.
        Image(systemName: destination.symbol)
            .resizable()
            .scaledToFit()
            .fontWeight(.semibold)
            .foregroundStyle(.white)
            .padding(size * 0.2)
            .frame(width: size, height: size)
            .background(
                destination.tileColor.gradient,
                in: .rect(cornerRadius: size * 0.24, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

extension SidebarRowSize {
    /// A destination tile's size beside a sidebar row, following the Sidebar icon size people
    /// choose in System Settings › Appearance.
    var appIconTileSize: CGFloat {
        switch self {
        case .small: 16
        case .medium: 20
        case .large: 24
        @unknown default: 20
        }
    }
}
