import Foundation
import Observation

@MainActor
@Observable
final class ModelSettings {
    private(set) var state: State = .loading
    var saveError: String?

    @ObservationIgnored private let client: any PicoSettingsServing
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var reloadRequested = false

    init(client: any PicoSettingsServing) {
        self.client = client
    }

    var isSaving: Bool {
        if case .saving = state { true } else { false }
    }

    var modelSelection: String {
        get { snapshot?.item.defaultModel ?? "" }
        set { chooseModel(newValue) }
    }

    var selectedModel: PicoModel? {
        guard let snapshot, let selected = snapshot.item.defaultModel else { return nil }
        return snapshot.models.first { $0.value == selected }
    }

    var settingsFile: String? {
        switch state {
        case .ready(let snapshot), .saving(let snapshot): snapshot.settingsFile
        case .invalid(let problem): problem.settingsFile
        case .loading, .failed: nil
        }
    }

    var showsSaveError: Bool {
        get { saveError != nil }
        set { if !newValue { saveError = nil } }
    }

    var snapshot: PicoModelSettings? {
        switch state {
        case .ready(let snapshot), .saving(let snapshot): snapshot
        case .loading, .failed, .invalid: nil
        }
    }

    var thinkingSelection: String {
        get { snapshot?.item.defaultThinking ?? "" }
        set { chooseThinking(newValue) }
    }

    func cancel() {
        generation += 1
        operation?.cancel()
        operation = nil
        reloadRequested = false
    }

    @discardableResult
    func chooseModel(_ model: String) -> Task<Void, Never>? {
        guard !model.isEmpty, model != snapshot?.item.defaultModel else { return nil }
        return save(.model(model))
    }

    @discardableResult
    func chooseThinking(_ thinking: String) -> Task<Void, Never>? {
        guard !thinking.isEmpty, thinking != snapshot?.item.defaultThinking else { return nil }
        return save(.thinking(thinking))
    }

    @discardableResult
    func reload() -> Task<Void, Never> {
        if isSaving, let operation {
            reloadRequested = true
            return operation
        }
        cancel()
        let request = generation
        state = .loading
        let task = Task { [weak self] in
            guard let self else { return }
            await load(request: request)
        }
        operation = task
        return task
    }

    private func apply(_ loaded: PicoSettingsLoad) {
        switch loaded {
        case .ready(let snapshot): state = .ready(snapshot)
        case .invalid(let problem): state = .invalid(problem)
        }
    }

    private func load(request: Int) async {
        do {
            let loaded = try await client.load()
            guard !Task.isCancelled, generation == request else { return }
            apply(loaded)
        } catch {
            guard !Task.isCancelled, generation == request else { return }
            state = .failed(error.localizedDescription)
        }
    }

    private func recoverConflict(request: Int) async {
        reloadRequested = false
        do {
            let loaded = try await client.load()
            guard !Task.isCancelled, generation == request else { return }
            apply(loaded)
            saveError = String(
                localized:
                    "Pico's settings changed outside this window. Nothing was saved. The current settings are shown."
            )
        } catch {
            guard !Task.isCancelled, generation == request else { return }
            state = .failed(error.localizedDescription)
            saveError = String(
                localized:
                    "Pico's settings changed outside this window. Nothing was saved, and the current settings could not be reloaded: \(error.localizedDescription)"
            )
        }
    }

    private func save(_ change: PicoSettingsChange) -> Task<Void, Never>? {
        guard case .ready(let previous) = state else { return nil }
        cancel()
        let request = generation
        saveError = nil
        state = .saving(previous)
        let task = Task { [weak self, client] in
            do {
                let receipt = try await client.update(change, revision: previous.revision)
                guard !Task.isCancelled, let self, generation == request else { return }
                state = .ready(previous.applying(receipt))
            } catch {
                guard !Task.isCancelled, let self, generation == request else { return }
                if let failure = error as? PicoCommandError, failure.code == "CONFLICT" {
                    await recoverConflict(request: request)
                } else {
                    state = .ready(previous)
                    saveError = error.localizedDescription
                }
            }
            guard !Task.isCancelled, let self, generation == request, reloadRequested else {
                return
            }
            reloadRequested = false
            state = .loading
            await load(request: request)
        }
        operation = task
        return task
    }
}

extension ModelSettings {
    enum State: Equatable {
        case loading
        case ready(PicoModelSettings)
        case saving(PicoModelSettings)
        case invalid(PicoSettingsProblem)
        case failed(String)
    }
}
