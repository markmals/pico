import SwiftUI

/// Index of every screen, so the whole prototype is walkable in one run.
struct GalleryScreen: View {
    var body: some View {
        NavigationStack {
            List(Screen.browsable) { screen in
                NavigationLink {
                    screen.content
                } label: {
                    VStack(alignment: .leading, spacing: Design.Space.tight) {
                        Text(screen.title)
                        Text(screen.subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, Design.Space.hairline)
                }
            }
            .navigationTitle("All Screens")
        }
    }
}

#Preview {
    GalleryScreen().prototypePreview()
}
