import SwiftUI

struct ModelsPane: View {
    var body: some View {
        Form {
            PaneHeader(destination: .models)

            Section {
                UnconnectedPicker(item: .model)
                UnconnectedPicker(item: .reasoningLevel)
            } header: {
                Text("Defaults")
            } footer: {
                Text("Choices come from the connected account's catalog, not from here.")
            }

            Section {
                TextField(text: .constant(""), prompt: Text("Not connected")) {
                    Text(SettingsItem.catalogSearch.title)
                }
                .disabled(true)
                .accessibilityLabel(Text(SettingsItem.catalogSearch.title))
                .settingsRow(.catalogSearch)
                UnconnectedValueRow(item: .availableModels)
            } header: {
                Text("Catalog")
            } footer: {
                Text("No catalog is loaded, so the search field filters nothing.")
            }
        }
        .formStyle(.grouped)
    }
}
