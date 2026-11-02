import SwiftUI

struct ModelsPane: View {
    @Environment(\.sampleSettings) private var sample

    var body: some View {
        Form {
            PaneHeader(destination: .models)

            Section {
                DefaultModelPickerRow(settings: sample)
                ReasoningLevelPickerRow(settings: sample)
            } header: {
                Text("Defaults")
            } footer: {
                sample == nil
                    ? Text("Choices come from the connected account's catalog, not from here.")
                    : Text("New Sesh sessions start with these. A session's own choice wins.")
            }

            Section {
                if let sample {
                    AvailableModelRows(settings: sample)
                } else {
                    SettingsValueRow(item: .availableModels, value: nil)
                }
            } header: {
                if sample == nil {
                    Text(SettingsItem.availableModels.displayTitle)
                } else {
                    Text(SettingsItem.availableModels.displayTitle)
                        .settingsRow(.availableModels)
                }
            } footer: {
                sample == nil
                    ? Text("No catalog is loaded while settings stay unconnected.")
                    : Text("Sign in to more providers in Providers & Accounts to use their models.")
            }
        }
        .formStyle(.grouped)
    }
}
