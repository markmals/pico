import SwiftUI

struct ModelsPane: View {
    var body: some View {
        Form {
            Section {
                UnconnectedPicker(label: "Model")
                UnconnectedPicker(label: "Reasoning level")
            } header: {
                Text("Defaults")
            } footer: {
                Text("Choices come from the connected account's catalog, not from here.")
            }

            Section {
                TextField("Search", text: .constant(""), prompt: Text("Not connected"))
                    .disabled(true)
                    .accessibilityLabel("Search")
                UnconnectedValueRow(label: "Available models")
            } header: {
                Text("Catalog")
            } footer: {
                Text("No catalog is loaded, so the search field filters nothing.")
            }
        }
        .formStyle(.grouped)
    }
}
