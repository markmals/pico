import SwiftUI

/// The row in Models' Defaults group that says why the defaults can't be changed, with the
/// one action that helps and the full cause.
struct ModelSettingsProblemRow: View {
    let settings: ModelSettings

    var body: some View {
        switch settings.state {
        case .failed(let message):
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    CautionLabel("Couldn’t load model settings")
                    Spacer()
                    Button("Try Again") { settings.reload() }
                }
                CommandErrorDetails(message: message)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Model defaults")
        case .invalid(let problem):
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    CautionLabel("Pico can’t read its settings file")
                    Spacer()
                    ShowSettingsFileButton(path: problem.settingsFile)
                }
                SettingsValueText(value: .verbatim(problem.settingsFile))
                    .font(.caption)
                    .textSelection(.enabled)
                CommandErrorDetails(message: problem.message)
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Model defaults")
        case .loading, .ready, .saving:
            EmptyView()
        }
    }
}
