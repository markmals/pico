import SwiftUI

struct SettingsPane: View {
    let destination: SettingsDestination

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.settingsReveal) private var reveal

    var body: some View {
        ScrollViewReader { proxy in
            PaneContent(destination: destination)
                .onChange(of: reveal, initial: true) { _, reveal in
                    guard let reveal, reveal.item.destination == destination else { return }
                    if reduceMotion {
                        proxy.scrollTo(reveal.item, anchor: .center)
                    } else {
                        withAnimation { proxy.scrollTo(reveal.item, anchor: .center) }
                    }
                }
        }
    }
}

private struct PaneContent: View {
    let destination: SettingsDestination

    var body: some View {
        switch destination {
        case .general: GeneralPane()
        case .providers: ProvidersPane()
        case .models: ModelsPane()
        case .tools: ToolsPane()
        case .sesh: SeshPane()
        case .diagnostics: DiagnosticsPane()
        }
    }
}
