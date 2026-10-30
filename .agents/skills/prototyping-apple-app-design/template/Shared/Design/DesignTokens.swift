import SwiftUI

/// The few values this prototype decides for itself.
///
/// Everything not listed here should come from the system: `Color.primary`,
/// `.secondary`, `Color(.systemGroupedBackground)`, `.font(.headline)`, and friends.
/// System semantics already handle dark mode, increased contrast, and Dynamic Type —
/// hardcoding hexes and point sizes throws all of that away and is the fastest way to
/// make an app look non-native.
enum Design {

    /// One tint carries the app's personality. Resist adding a second accent.
    static let tint = Color.accentColor

    /// A 4-point rhythm. Use these instead of scattering literals through layouts.
    enum Space {
        static let hairline: CGFloat = 2
        static let tight: CGFloat = 4
        static let snug: CGFloat = 8
        static let regular: CGFloat = 12
        static let roomy: CGFloat = 16
        static let section: CGFloat = 24
        static let generous: CGFloat = 32
    }

    /// Match the platform's own curvature rather than inventing radii.
    enum Radius {
        static let control: CGFloat = 10
        static let card: CGFloat = 16
    }

    /// Minimum comfortable hit target on touch platforms.
    static let minimumTapTarget: CGFloat = 44
}
