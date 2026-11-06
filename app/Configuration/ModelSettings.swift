import Foundation
import Observation

@MainActor
@Observable
final class ModelSettings {
    private(set) var settingsFile: SettingsFileState = .loading
    private(set) var state: State = .loading
    var saveError: String?

    @ObservationIgnored private let client: any PicoSettingsServing
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var reloadRequested = false

    init(client: any PicoSettingsServing) {
        self.client = client
    }

    var displayedDefaults: PicoDefaults? {
        switch state {
        case .ready(let snapshot): snapshot.item
        case .saving(let pending): pending.displayedDefaults
        case .loading, .failed, .invalid: nil
        }
    }

    var isSaving: Bool {
        if case .saving = state { true } else { false }
    }

    var modelSelection: String {
        get { displayedDefaults?.defaultModel ?? "" }
        set { chooseModel(newValue) }
    }

    var selectedModel: PicoModel? {
        guard let snapshot, let selected = displayedDefaults?.defaultModel else { return nil }
        return snapshot.models.first { $0.value == selected }
    }

    var showsSaveError: Bool {
        get { saveError != nil }
        set { if !newValue { saveError = nil } }
    }

    var snapshot: PicoModelSettings? {
        switch state {
        case .ready(let snapshot): snapshot
        case .saving(let pending): pending.confirmed
        case .loading, .failed, .invalid: nil
        }
    }

    var thinkingSelection: String {
        get { displayedDefaults?.defaultThinking ?? "" }
        set { chooseThinking(newValue) }
    }

    func cancel() {
        generation += 1
        operation?.cancel()
        operation = nil
        reloadRequested = false
        if case .saving(let pending) = state {
            state = .ready(pending.confirmed)
        }
    }

    @discardableResult
    func chooseModel(_ model: String) -> Task<Void, Never>? {
        guard !model.isEmpty, model != displayedDefaults?.defaultModel else { return nil }
        return save(.model(model))
    }

    @discardableResult
    func chooseThinking(_ thinking: String) -> Task<Void, Never>? {
        guard !thinking.isEmpty, thinking != displayedDefaults?.defaultThinking,
            let model = displayedDefaults?.defaultModel
        else { return nil }
        return save(.thinking(model: model, level: thinking))
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

    private func advanceSave(receipt: PicoSettingsReceipt?) {
        guard case .saving(let pending) = state else { return }
        let confirmed = receipt.map { pending.confirmed.applying($0) } ?? pending.confirmed
        if let next = pending.next(after: confirmed) {
            state = .saving(next)
        } else {
            state = .ready(confirmed)
        }
    }

    private func drainSaves(request: Int) async {
        while case .saving(let pending) = state {
            do {
                let receipt = try await client.update(
                    pending.change,
                    revision: pending.confirmed.revision
                )
                guard isCurrent(request) else { return }
                advanceSave(receipt: receipt)
            } catch {
                guard isCurrent(request) else { return }
                if let failure = error as? PicoCommandError, failure.code == "CONFLICT" {
                    await recoverConflict(request: request)
                    return
                }
                advanceSave(receipt: nil)
                saveError = error.localizedDescription
            }
        }
        guard !Task.isCancelled, generation == request, reloadRequested else { return }
        reloadRequested = false
        state = .loading
        await load(request: request)
    }

    private func isCurrent(_ request: Int) -> Bool {
        !Task.isCancelled && generation == request
    }

    private func load(request: Int) async {
        guard isCurrent(request) else { return }
        settingsFile = .loading
        async let catalog = client.readCatalog()
        let read: PicoSettingsRead
        do {
            read = try await client.readSettings()
        } catch {
            guard isCurrent(request) else { return }
            settingsFile = .failed(error.localizedDescription)
            state = .failed(error.localizedDescription)
            return
        }
        guard isCurrent(request) else { return }
        switch read {
        case .invalid(let problem):
            settingsFile = .known(problem.settingsFile)
            state = .invalid(problem)
        case .ready(let path, let revision, let item, let effective):
            settingsFile = .known(path)
            do {
                let models = try await catalog
                guard isCurrent(request) else { return }
                state = .ready(
                    PicoModelSettings(
                        settingsFile: path,
                        revision: revision,
                        item: item,
                        effective: effective,
                        models: models
                    )
                )
            } catch {
                guard isCurrent(request) else { return }
                state = .failed(error.localizedDescription)
            }
        }
    }

    private func recoverConflict(request: Int) async {
        reloadRequested = false
        state = .loading
        saveError = String(
            localized:
                "Pico's settings changed outside this window. Pending changes weren't saved. Review the current settings before trying again."
        )
        await load(request: request)
        guard isCurrent(request), case .failed(let message) = state else { return }
        saveError = String(
            localized:
                "Pico's settings changed outside this window. Pending changes weren't saved, and the current settings could not be reloaded: \(message)"
        )
    }

    private func save(_ change: PicoSettingsChange) -> Task<Void, Never>? {
        switch state {
        case .saving(var pending):
            pending.append(change)
            state = .saving(pending)
            saveError = nil
            return operation
        case .ready(let confirmed):
            cancel()
            let request = generation
            saveError = nil
            state = .saving(PendingModelSettings(confirmed: confirmed, change: change))
            let task = Task { [weak self] in
                guard let self else { return }
                await drainSaves(request: request)
            }
            operation = task
            return task
        case .loading, .failed, .invalid:
            return nil
        }
    }
}

extension ModelSettings {
    /// Where Pico's settings file is, as the last `settings get` reported it. It is published
    /// as soon as that read answers, whether or not the model catalog is usable.
    enum SettingsFileState: Equatable {
        case loading
        case known(String)
        case failed(String)

        var path: String? {
            if case .known(let path) = self { path } else { nil }
        }
    }
}

extension ModelSettings {
    enum State: Equatable {
        case loading
        case ready(PicoModelSettings)
        case saving(PendingModelSettings)
        case invalid(PicoSettingsProblem)
        case failed(String)
    }
}
