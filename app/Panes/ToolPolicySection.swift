import SwiftUI

struct ToolPolicySection: View {
    var body: some View {
        Section {
            ForEach(BuiltinToolPolicy.included, id: \.item) { policy in
                ToolPolicyRow(isIncluded: true, item: policy.item, symbol: policy.symbol)
            }
        } header: {
            Text("Included tools")
        }
        Section {
            ToolPolicyRow(isIncluded: false, item: .eval, symbol: "curlybraces")
            ToolPolicyRow(
                isIncluded: false,
                item: .builtInLSP,
                symbol: "chevron.left.forwardslash.chevron.right"
            )
            ToolPolicyRow(isIncluded: false, item: .nativeDelegation, symbol: "person.2")
        } header: {
            Text("Excluded tools")
        }
    }
}
