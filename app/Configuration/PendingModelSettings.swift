struct PendingModelSettings: Equatable {
    let confirmed: PicoModelSettings
    let change: PicoSettingsChange
    private(set) var displayedDefaults: PicoDefaults

    private var queuedChanges: ArraySlice<PicoSettingsChange>

    init(
        confirmed: PicoModelSettings,
        change: PicoSettingsChange,
        queuedChanges: ArraySlice<PicoSettingsChange> = []
    ) {
        self.confirmed = confirmed
        self.change = change
        self.queuedChanges = queuedChanges
        var displayed = Self.project(change, onto: confirmed.item, models: confirmed.models)
        for queued in queuedChanges {
            displayed = Self.project(queued, onto: displayed, models: confirmed.models)
        }
        displayedDefaults = displayed
    }

    mutating func append(_ change: PicoSettingsChange) {
        queuedChanges.append(change)
        displayedDefaults = Self.project(change, onto: displayedDefaults, models: confirmed.models)
    }

    func next(after snapshot: PicoModelSettings) -> Self? {
        guard let next = queuedChanges.first else { return nil }
        return Self(confirmed: snapshot, change: next, queuedChanges: queuedChanges.dropFirst())
    }

    private static func project(
        _ change: PicoSettingsChange,
        onto defaults: PicoDefaults,
        models: [PicoModel]
    ) -> PicoDefaults {
        switch change {
        case .intellisensePath(let path):
            return PicoDefaults(
                defaultModel: defaults.defaultModel,
                defaultThinking: defaults.defaultThinking,
                intellisensePath: path
            )
        case .model(let value):
            guard let model = models.first(where: { $0.value == value }) else {
                return PicoDefaults(
                    defaultModel: value,
                    defaultThinking: defaults.defaultThinking,
                    intellisensePath: defaults.intellisensePath
                )
            }
            let retained = defaults.defaultThinking.flatMap { level in
                model.thinking.contains { $0.value == level } ? level : nil
            }
            return PicoDefaults(
                defaultModel: value,
                defaultThinking: retained ?? model.defaultThinking,
                intellisensePath: defaults.intellisensePath
            )
        case .thinking(let model, let level):
            return PicoDefaults(
                defaultModel: model,
                defaultThinking: level,
                intellisensePath: defaults.intellisensePath
            )
        }
    }
}
