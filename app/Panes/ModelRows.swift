import SwiftUI

struct DefaultModelPickerRow: View {
    let settings: SampleSettings?

    var body: some View {
        if let settings, !settings.availableModels.isEmpty {
            Picker(selection: selection(settings)) {
                ForEach(settings.availableModels) { model in
                    Text(verbatim: model.name).tag(Optional(model))
                }
            } label: {
                Text(SettingsItem.model.title)
            }
            .settingsRow(.model)
        } else if settings != nil {
            UnavailablePicker(item: .model, reason: "None available")
        } else {
            UnavailablePicker(item: .model)
        }
    }

    private func selection(_ settings: SampleSettings) -> Binding<SampleModel?> {
        Binding {
            settings.defaultModel
        } set: { model in
            if let model { settings.chooseDefaultModel(model) }
        }
    }
}

struct ReasoningLevelPickerRow: View {
    let settings: SampleSettings?

    var body: some View {
        if let settings, !settings.reasoningLevels.isEmpty {
            @Bindable var settings = settings
            Picker(selection: $settings.reasoningLevel) {
                ForEach(settings.reasoningLevels) { level in
                    Text(level.title).tag(level)
                }
            } label: {
                Text(SettingsItem.reasoningLevel.title)
            }
            .settingsRow(.reasoningLevel)
        } else if settings != nil {
            UnavailablePicker(item: .reasoningLevel, reason: "None available")
        } else {
            UnavailablePicker(item: .reasoningLevel)
        }
    }
}

struct CatalogSearchRow: View {
    let settings: SampleSettings?

    var body: some View {
        if let settings {
            @Bindable var settings = settings
            TextField(text: $settings.catalogQuery, prompt: Text("Model or provider")) {
                Text(SettingsItem.catalogSearch.title)
            }
            .settingsRow(.catalogSearch)
        } else {
            TextField(text: .constant(""), prompt: Text("Not connected")) {
                Text(SettingsItem.catalogSearch.title)
            }
            .disabled(true)
            .accessibilityLabel(Text(SettingsItem.catalogSearch.title))
            .settingsRow(.catalogSearch)
        }
    }
}

/// The sample catalog's models that match the catalog search, each with its provider.
struct ModelCatalogRows: View {
    let settings: SampleSettings

    var body: some View {
        if settings.catalogResults.isEmpty {
            Text("No Results")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
        }
        ForEach(settings.catalogResults) { model in
            LabeledContent {
                availability(of: model)
            } label: {
                Text(verbatim: model.name)
                Text(verbatim: model.provider.name)
            }
        }
    }

    @ViewBuilder private func availability(of model: SampleModel) -> some View {
        if !settings.isSignedIn(model.provider) {
            SettingsValueText(value: .status("Needs sign-in", .attention))
        } else if model == settings.defaultModel {
            SettingsValueText(value: .text("Default"))
        }
    }
}
