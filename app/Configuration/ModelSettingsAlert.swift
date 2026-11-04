import SwiftUI

struct ModelSettingsAlert: ViewModifier {
    @Bindable var settings: ModelSettings

    func body(content: Content) -> some View {
        content.alert("Pico Couldn't Save Settings", isPresented: $settings.showsSaveError) {
            Button("OK") { settings.saveError = nil }
        } message: {
            if let message = settings.saveError {
                Text(verbatim: message)
            }
        }
    }
}
