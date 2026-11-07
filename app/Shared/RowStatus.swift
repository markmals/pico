import SwiftUI

/// A row's trailing status. One that needs the user's attention is led by the caution symbol
/// and drawn in primary text, so it stands apart from routine values beside it.
struct RowStatus: View {
    let text: LocalizedStringResource
    var needsAttention = false

    var body: some View {
        HStack(spacing: 4) {
            if needsAttention {
                CautionSymbol()
            }
            Text(text)
                .foregroundStyle(needsAttention ? HierarchicalShapeStyle.primary : .secondary)
        }
    }
}
