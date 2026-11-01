import SwiftUI

struct ToolPolicySection: View {
    var body: some View {
        Section {
            ToolPolicyRow(isIncluded: true, item: .read, symbol: "doc.text")
            ToolPolicyRow(isIncluded: true, item: .search, symbol: "magnifyingglass")
            ToolPolicyRow(isIncluded: true, item: .edit, symbol: "pencil")
            ToolPolicyRow(isIncluded: true, item: .write, symbol: "square.and.pencil")
            ToolPolicyRow(isIncluded: true, item: .shell, symbol: "terminal")
            ToolPolicyRow(isIncluded: true, item: .webSearch, symbol: "globe")
            ToolPolicyRow(isIncluded: false, item: .eval, symbol: "curlybraces")
            ToolPolicyRow(
                isIncluded: false,
                item: .builtInLSP,
                symbol: "chevron.left.forwardslash.chevron.right"
            )
            ToolPolicyRow(isIncluded: false, item: .nativeDelegation, symbol: "person.2")
        } header: {
            Text("Built-in tool policy")
        } footer: {
            Text(
                "The adapter fixes these built-in tools; each session also adds the tools Sesh supplies. Not editable here."
            )
        }
    }
}
