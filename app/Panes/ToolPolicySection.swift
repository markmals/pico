import SwiftUI

struct ToolPolicySection: View {
    var body: some View {
        Section {
            ToolPolicyRow(name: "Read", status: "Included", symbol: "doc.text")
            ToolPolicyRow(name: "Search", status: "Included", symbol: "magnifyingglass")
            ToolPolicyRow(name: "Edit", status: "Included", symbol: "pencil")
            ToolPolicyRow(name: "Write", status: "Included", symbol: "square.and.pencil")
            ToolPolicyRow(name: "Shell", status: "Included", symbol: "terminal")
            ToolPolicyRow(name: "Web search", status: "Included", symbol: "globe")
            ToolPolicyRow(name: "Eval", status: "Excluded", symbol: "curlybraces")
            ToolPolicyRow(name: "Built-in LSP", status: "Excluded", symbol: "stethoscope")
            ToolPolicyRow(name: "Native delegation", status: "Excluded", symbol: "person.2")
        } header: {
            Text("Curated tool policy")
        } footer: {
            Text("The roster is fixed in the adapter and is not editable here.")
        }
    }
}
