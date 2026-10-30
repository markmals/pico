import SwiftUI

/// Hosts whichever screen was requested, owns the mock, and exposes the live knobs.
struct PrototypeRoot: View {
    @State private var condition = PrototypeLaunch.condition
    @State private var appearance = PrototypeLaunch.colorScheme
    @State private var variant = PrototypeLaunch.variant
    @State private var model = NotesModel.preview(PrototypeLaunch.condition)

    private let screen = PrototypeLaunch.screen

    var body: some View {
        screen.content
            .environment(model)
            .environment(\.variant, variant)
            .preferredColorScheme(appearance)
            .dynamicTypeSize(PrototypeLaunch.dynamicTypeSize ?? .large)
            .overlay(alignment: .bottomTrailing) {
                // watchOS has no `Menu`, and no room for one. Watch prototypes are
                // driven by launch flags instead.
                #if !os(watchOS)
                if !PrototypeLaunch.isCapturing {
                    PrototypeKnobs(
                        condition: $condition,
                        appearance: $appearance,
                        variant: $variant
                    )
                        .padding(Design.Space.roomy)
                }
                #endif
            }
            .task(id: condition) { await start() }
    }

    /// Loads the mock, then tells any capture script that the screen is real.
    ///
    /// Order matters. For `.slow` the loading treatment *is* the thing being
    /// designed, so readiness fires while the request is still in flight. Otherwise
    /// readiness waits for content, so screenshots never catch a transient spinner.
    private func start() async {
        let fresh = NotesModel.preview(condition)
        model = fresh

        if condition == .slow {
            try? await Task.sleep(for: .milliseconds(250))
            PrototypeCapture.signalReady(screen: screen)
            await fresh.load()
        } else {
            await fresh.load()
            try? await Task.sleep(for: .milliseconds(150))
            PrototypeCapture.signalReady(screen: screen)
        }
    }
}

#if !os(watchOS)
/// Live controls for the states a design has to answer for. Hidden during capture
/// and absent from `#Preview`, so it never contaminates the design being reviewed.
private struct PrototypeKnobs: View {
    @Binding var condition: MockCondition
    @Binding var appearance: ColorScheme?
    @Binding var variant: Variant

    var body: some View {
        Menu {
            Picker("Data", selection: $condition) {
                ForEach(MockCondition.allCases) { Text($0.label).tag($0) }
            }
            Picker("Appearance", selection: $appearance) {
                Text("System").tag(ColorScheme?.none)
                Text("Light").tag(ColorScheme?.some(.light))
                Text("Dark").tag(ColorScheme?.some(.dark))
            }
            if Variant.allCases.count > 1 {
                Picker("Direction", selection: $variant) {
                    ForEach(Variant.allCases) { Text($0.label).tag($0) }
                }
            }
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 24, height: 24)
        }
        // A floating control above content is the textbook case for Liquid Glass.
        // `.borderlessButton` looks correct on iOS but collapses to a bare chevron on
        // macOS, so the button menu style plus `.glass` is what reads right on both.
        .menuStyle(.button)
        .buttonStyle(.glass)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel("Prototype controls")
    }
}
#endif
