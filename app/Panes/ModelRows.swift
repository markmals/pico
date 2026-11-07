import SwiftUI

struct DefaultModelPickerRow: View {
    @Bindable var settings: ModelSettings

    var body: some View {
        if let snapshot = settings.snapshot, !snapshot.models.isEmpty {
            Picker(selection: $settings.modelSelection) {
                if settings.displayedDefaults?.defaultModel == nil {
                    Text("Not Set").tag("")
                } else if settings.selectedModel == nil,
                    let selected = settings.displayedDefaults?.defaultModel
                {
                    Text("\(selected) (unavailable)").tag(selected)
                }
                ForEach(snapshot.models) { model in
                    Text(verbatim: model.name)
                        .tag(model.value)
                        .help(model.provider)
                }
            } label: {
                Text(SettingsItem.model.title)
            }
            .accessibilityLabel(Text(SettingsItem.model.title))
            .settingsRow(.model)
        } else if let saved = settings.displayedDefaults?.defaultModel {
            UnavailablePicker(item: .model, reason: "\(saved) (unavailable)")
        } else {
            UnavailablePicker(item: .model, reason: unavailableReason)
        }
    }

    private var unavailableReason: LocalizedStringResource {
        switch settings.state {
        case .loading: "Loading…"
        case .ready, .saving: "None available"
        case .failed, .invalid: "Unavailable"
        }
    }
}

struct ReasoningLevelPickerRow: View {
    @Bindable var settings: ModelSettings

    var body: some View {
        if let model = settings.selectedModel, !model.thinking.isEmpty {
            Picker(selection: $settings.thinkingSelection) {
                if !model.thinking.contains(where: { $0.value == settings.thinkingSelection }) {
                    let title: LocalizedStringResource =
                        PicoModel.ThinkingChoice.displayName(for: settings.thinkingSelection)
                        ?? "\(settings.thinkingSelection)"
                    Text("\(Text(title)) (unavailable)")
                        .tag(settings.thinkingSelection)
                }
                ForEach(model.thinking) { level in
                    Text(level.displayName).tag(level.value)
                }
            } label: {
                Text(SettingsItem.reasoningLevel.title)
            }
            .accessibilityLabel(Text(SettingsItem.reasoningLevel.title))
            .settingsRow(.reasoningLevel)
        } else {
            UnavailablePicker(item: .reasoningLevel, reason: unavailableReason)
        }
    }

    private var unavailableReason: LocalizedStringResource {
        switch settings.state {
        case .loading: "Loading…"
        case .ready, .saving:
            settings.displayedDefaults?.defaultModel == nil ? "Not Set" : "Unavailable"
        case .failed, .invalid: "Unavailable"
        }
    }
}

struct AvailableModelRows: View {
    let models: [PicoModel]
    let defaultModel: String?

    var body: some View {
        if models.isEmpty {
            Text("None available")
                .foregroundStyle(.secondary)
        }
        ForEach(models) { model in
            LabeledContent {
                if model.value == defaultModel {
                    SettingsValueText(value: .text("Default"))
                }
            } label: {
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: model.name)
                    Text(verbatim: model.value)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: model.name))
            .accessibilityValue(
                model.value == defaultModel
                    ? Text("\(model.value), Default") : Text(verbatim: model.value)
            )
            .accessibilityAddTraits(.isStaticText)
        }
    }
}
