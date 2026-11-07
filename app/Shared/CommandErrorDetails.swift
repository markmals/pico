import SwiftUI

struct CommandErrorDetails: View {
    let message: String

    var body: some View {
        DisclosureGroup("Error Details") {
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
