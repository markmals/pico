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

    var settingsFile: String? {
        switch state {
        case .ready, .saving: snapshot?.settingsFile
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

    private func apply(_ loaded: PicoSettingsLoad) {
        switch loaded {
        case .ready(let snapshot): state = .ready(snapshot)
        case .invalid(let problem): state = .invalid(problem)
        }
    }

    private func drainSaves(request: Int) async {
        while case .saving(let pending) = state {
            do {
                let receipt = try await client.update(
                    pending.change,
                    revision: pending.confirmed.revision
                )
                guard !Task.isCancelled, generation == request else { return }
                advanceSave(receipt: receipt)
            } catch {
                guard !Task.isCancelled, generation == request else { return }
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
        state = .loading
        saveError = String(
            localized:
                "Pico's settings changed outside this window. Pending changes weren't saved. Review the current settings before trying again."
        )
        do {
            let loaded = try await client.load()
            guard !Task.isCancelled, generation == request else { return }
            apply(loaded)
        } catch {
            guard !Task.isCancelled, generation == request else { return }
            state = .failed(error.localizedDescription)
            saveError = String(
                localized:
                    "Pico's settings changed outside this window. Pending changes weren't saved, and the current settings could not be reloaded: \(error.localizedDescription)"
            )
        }
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
    enum State: Equatable {
        case loading
        case ready(PicoModelSettings)
        case saving(PendingModelSettings)
        case invalid(PicoSettingsProblem)
        case failed(String)
    }
}
