import SwiftUI

struct ModelDefaultsFooter: View {
    let settings: ModelSettings

    var body: some View {
        switch settings.state {
        case .loading:
            Text("Loading Pico's settings and model catalog…")
        case .failed:
            EmptyView()
        case .invalid(let problem):
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: problem.message)
                Text("Fix or remove this settings file before changing model defaults.")
                ShowSettingsFileButton(path: problem.settingsFile)
            }
        case .saving:
            Text("Saving changes…")
        case .ready(let snapshot):
            if snapshot.item.defaultModel != nil && !snapshot.effective.available {
                Text(
                    "The saved model or reasoning level is unavailable. New sessions will fail to start until you choose an available model and level."
                )
            } else if snapshot.item.defaultModel != nil && settings.selectedModel == nil {
                Text(
                    "The saved model is unavailable. New sessions will fail to start until you choose another model."
                )
            } else if snapshot.models.isEmpty {
                Text(
                    "No model has usable credentials. Connect and select a provider using Pico's commands, then return to Models."
                )
            } else if snapshot.item.defaultModel == nil {
                if let fallback = snapshot.effective.defaultModel {
                    Text(
                        "Until you choose a model, Pico uses \(fallback) for new sessions without a model override from Sesh."
                    )
                } else {
                    Text(
                        "Choose a model before starting a new session without a model override. No automatic default is available."
                    )
                }
            } else {
                Text(
                    "Pico uses this model and reasoning level for new sessions without a model override from Sesh. Open sessions keep their own choices."
                )
            }
        }
    }
}
