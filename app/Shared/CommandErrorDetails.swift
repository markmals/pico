import SwiftUI

/// A failure's full cause, open from the moment the failure appears so the user reads why
/// before deciding what to do; they can still collapse it.
struct CommandErrorDetails: View {
    let message: String

    @State private var isExpanded = true

    var body: some View {
        DisclosureGroup("Error Details", isExpanded: $isExpanded) {
            ViewThatFits(in: .vertical) {
                messageText
                ScrollView {
                    messageText
                }
                .frame(height: 120)
            }
            .frame(maxHeight: 120, alignment: .topLeading)
        }
    }

    private var messageText: some View {
        Text(verbatim: message)
            .font(.callout)
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 12)
    }
}
