import SwiftUI

struct SettingsPane: View {
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
