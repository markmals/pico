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
            .accessibilityLabel(Text(SettingsItem.model.title))
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
            .accessibilityLabel(Text(SettingsItem.reasoningLevel.title))
            .settingsRow(.reasoningLevel)
        } else if settings != nil {
            UnavailablePicker(item: .reasoningLevel, reason: "None available")
        } else {
            UnavailablePicker(item: .reasoningLevel)
        }
    }
}

/// The models of signed-in providers, each with its provider; the default is marked.
struct AvailableModelRows: View {
    let settings: SampleSettings

    var body: some View {
        if settings.availableModels.isEmpty {
            Text("None available")
                .foregroundStyle(.secondary)
        }
        ForEach(settings.availableModels) { model in
            LabeledContent {
                if model == settings.defaultModel {
                    SettingsValueText(value: .text("Default"))
                }
            } label: {
                HStack(spacing: 10) {
                    ProviderTile(provider: model.provider, size: 24)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: model.name)
                        Text(verbatim: model.provider.name)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
