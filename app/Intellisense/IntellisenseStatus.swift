import Foundation
import Observation

/// What Pico knows about the `intellisense` program a new session would run. It checks only
/// when asked — when Tools & Integrations opens, when the user asks again, and when the saved
/// location changes — and keeps the last location it observed while the next check runs.
@MainActor
@Observable
final class IntellisenseStatus {
    private(set) var isChecking = false
    private(set) var outcome: Outcome?

    @ObservationIgnored private let client: any IntellisenseChecking
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var hasChecked = false
    @ObservationIgnored private var operation: Task<Void, Never>?
    @ObservationIgnored private var requested: String?

    init(client: any IntellisenseChecking) {
        self.client = client
    }

    func cancel() {
        guard let operation else { return }
        generation += 1
        operation.cancel()
        self.operation = nil
        isChecking = false
    }

    /// Checks the location `location` names, joining a check already running for it. A check
    /// running for a different location is abandoned: its answer describes a location that is
    /// no longer the saved one.
    @discardableResult
    func check(for location: String?) -> Task<Void, Never> {
        if let operation, requested == location { return operation }
        generation += 1
        operation?.cancel()
        hasChecked = true
        requested = location
        isChecking = true
        let request = generation
        let task = Task { [weak self] in
            guard let self else { return }
            await run(request)
        }
        operation = task
        return task
    }

    /// Checks again when the saved location is no longer the one the last check used. Nothing
    /// is checked until Tools & Integrations asks for it, so settings arriving with a saved
    /// location do not start a check of their own.
    @discardableResult
    func check(ifChangedTo location: String?) -> Task<Void, Never>? {
        guard hasChecked, requested != location else { return nil }
        return check(for: location)
    }

    private func isCurrent(_ request: Int) -> Bool {
        !Task.isCancelled && generation == request
    }

    private func run(_ request: Int) async {
        let observed: Outcome
        do {
            observed = .checked(try await client.check())
        } catch is CancellationError {
            return
        } catch {
            observed = .failed(error.localizedDescription)
        }
        guard isCurrent(request) else { return }
        outcome = observed
        isChecking = false
        operation = nil
    }
}

extension IntellisenseStatus {
    enum Outcome: Equatable, Sendable {
        case checked(IntellisenseCheck)
        /// The check itself could not run, with its cause.
        case failed(String)

        /// Where the last check resolved, which the row keeps showing while the next runs.
        var path: String? {
            switch self {
            case .checked(.ready(let path, _)), .checked(.unusable(let path, _)): path
            case .checked(.missing), .failed: nil
            }
        }
    }
}
