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
                CatalogSearchRow(settings: sample)
                SettingsValueRow(item: .availableModels, value: availableModels)
                if let sample {
                    ModelCatalogRows(settings: sample)
                }
            } header: {
                Text("Catalog")
            } footer: {
                sample == nil
                    ? Text("No catalog is loaded, so the search field filters nothing.")
                    : Text("Models of providers that need sign-in can't be chosen.")
            }
        }
        .formStyle(.grouped)
    }

    private var availableModels: SettingsValue? {
        sample.map {
            .text("\($0.availableModels.count) of \(SampleModel.catalog.count)")
        }
    }
}
