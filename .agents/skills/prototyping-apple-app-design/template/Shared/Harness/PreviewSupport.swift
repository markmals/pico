import SwiftUI

extension View {
    /// Wires a screen up to a mock for `#Preview`, including the async load.
    ///
    /// Keeps preview blocks to a single line, which is the difference between
    /// previewing every state and previewing only the convenient one.
    func prototypePreview(_ condition: MockCondition = .populated) -> some View {
        modifier(PrototypePreviewModifier(condition: condition))
    }
}

private struct PrototypePreviewModifier: ViewModifier {
    let condition: MockCondition

    @State private var model: NotesModel

    init(condition: MockCondition) {
        self.condition = condition
        _model = State(initialValue: .preview(condition))
    }

    func body(content: Content) -> some View {
        content
            .environment(model)
            .task { await model.load() }
    }
}
