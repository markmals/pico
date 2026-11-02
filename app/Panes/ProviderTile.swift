import SwiftUI

/// A provider's tile: its logo in white on the provider's color, shaped like the pane tiles.
/// The logos are LobeHub's icons; `ThirdPartyNotices.md` carries their license.
struct ProviderTile: View {
    let provider: SampleProvider
    let size: CGFloat

    var body: some View {
        Image("ProviderLogos/\(provider.rawValue)")
            .resizable()
            .scaledToFit()
            .foregroundStyle(.white)
            .padding(size * 0.2)
            .frame(width: size, height: size)
            .background(
                provider.tileColor.gradient,
                in: .rect(cornerRadius: size * 0.24, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

extension SampleProvider {
    fileprivate var tileColor: Color {
        switch self {
        case .anthropic: Color(red: 0.85, green: 0.47, blue: 0.34)
        case .openAI: .black
        case .google: .blue
        case .openRouter: .indigo
        case .xAI: .black
        case .mistral: .orange
        case .groq: Color(red: 0.96, green: 0.31, blue: 0.21)
        }
    }
}

extension SampleSettings {
    /// A provider's one-line status, as its list row and page header show it.
    func statusLine(of provider: SampleProvider) -> Text {
        guard let method = signInMethod(of: provider) else { return Text("Not signed in") }
        // Verbatim, so the account's address is not turned into a mail link.
        return Text(verbatim: String(localized: provider.accountLabel(for: method)))
    }
}
