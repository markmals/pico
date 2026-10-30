import SwiftUI

/// Competing design directions for the same screens.
///
/// A prototype's job is to make a choice *visible*, not to guess one. Add a case per
/// direction being explored, branch on `@Environment(\.variant)` inside a screen, and
/// capture them with `shoot.ts --all-variants`. Reviewing three captures side by side
/// beats describing three options in prose.
///
/// Keep the set small and genuinely different — three directions that disagree about
/// layout or hierarchy are worth more than six that disagree about corner radius.
enum Variant: String, CaseIterable, Identifiable {
    case baseline

    var id: String { rawValue }

    var label: String {
        switch self {
        case .baseline: "Baseline"
        }
    }
}

extension EnvironmentValues {
    @Entry var variant: Variant = .baseline
}
