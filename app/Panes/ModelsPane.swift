import SwiftUI

struct ModelsPane: View {
    @Environment(ModelSettings.self) private var settings

    var body: some View {
        Form {
            PaneHeader(destination: .models)

            Section {
                DefaultModelPickerRow(settings: settings)
                ReasoningLevelPickerRow(settings: settings)
                ModelSettingsProblemRow(settings: settings)
            } header: {
                Text("Defaults")
            } footer: {
                ModelDefaultsFooter(settings: settings)
            }

            Section {
                if let snapshot = settings.snapshot {
                    AvailableModelRows(
                        models: snapshot.models,
                        defaultModel: settings.displayedDefaults?.defaultModel
                    )
                } else {
                    Text("Unavailable")
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text(SettingsItem.availableModels.displayTitle)
                    .settingsRow(.availableModels)
            }
        }
        .formStyle(.grouped)
    }
}
