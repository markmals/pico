import SwiftUI

/// A provider's tile: its initial on a fixed color, shaped like the pane tiles. Provider logos
/// are not used.
struct ProviderTile: View {
    let provider: SampleProvider
    let size: CGFloat

    var body: some View {
        Text(verbatim: String(provider.name.prefix(1)))
            .font(.system(size: size * 0.5, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
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
        case .anthropic: .orange
        case .openAI: .green
        case .google: .blue
        case .openRouter: .indigo
        case .xAI: .gray
        case .mistral: .pink
        case .groq: .red
        }
    }
}

extension SampleSettings {
    /// A provider's one-line status, as its list row and page header show it.
    func statusLine(of provider: SampleProvider) -> Text {
        guard isAdded(provider) else { return Text("Not set up") }
        guard isSignedIn(provider), let account = account(of: provider) else {
            return Text("Needs sign-in")
        }
        return Text("Signed in · \(account)")
    }
}
