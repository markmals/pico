import Darwin
import Foundation

struct PicoProcessOutcome: Sendable {
    let standardError: Data
    let standardOutput: Data
    let status: Int32
}

enum PicoProcessFailure: Error {
    case cannotStart(any Error)
    case timedOut
}

// Mutable state is confined to queue, including termination and cancellation callbacks.
// Finish on process termination, not pipe EOF: descendants can retain inherited write ends.
final class PicoProcessRun: @unchecked Sendable {
    private static let graceAfterStopping: TimeInterval = 1

    private let arguments: [String]
    private let executable: URL
    private let process = Process()
    private let queue = DispatchQueue(label: "me.malstrom.pico.command", qos: .userInitiated)
    private let standardError = PicoPipeDrain(retention: .last(64 * 1024))
    private let standardOutput = PicoPipeDrain(retention: .all)
    private let timeout: TimeInterval

    private var continuation: CheckedContinuation<PicoProcessOutcome, any Error>?
    private var deadlineTimer: (any DispatchSourceTimer)?
    private var hasLaunched = false
    private var isFinished = false
    private var killTimer: (any DispatchSourceTimer)?
    private var stop: Stop?

    init(executable: URL, arguments: [String], timeout: TimeInterval) {
        self.arguments = arguments
        self.executable = executable
        self.timeout = timeout
    }

    // Cancellation also waits for termination so callers do not outlive an abandoned command.
    func run() async throws -> PicoProcessOutcome {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                queue.async { self.start(continuation) }
            }
        } onCancel: {
            queue.async { self.requestStop(.cancelled) }
        }
    }

    private func finish(_ result: Result<PicoProcessOutcome, any Error>) {
        guard !isFinished else { return }
        isFinished = true
        deadlineTimer?.cancel()
        deadlineTimer = nil
        killTimer?.cancel()
        killTimer = nil
        standardOutput.close()
        standardError.close()
        let continuation = self.continuation
        self.continuation = nil
        continuation?.resume(with: result)
    }

    private func killIfStillRunning() {
        guard !isFinished, hasLaunched, process.isRunning else { return }
        kill(process.processIdentifier, SIGKILL)
    }

    private func processEnded() {
        guard !isFinished else { return }
        standardOutput.drainAvailable()
        standardError.drainAvailable()
        switch stop {
        case .cancelled:
            finish(.failure(CancellationError()))
        case .deadline:
            finish(.failure(PicoProcessFailure.timedOut))
        case nil:
            let outcome = PicoProcessOutcome(
                standardError: standardError.collected,
                standardOutput: standardOutput.collected,
                status: process.terminationStatus
            )
            finish(.success(outcome))
        }
    }

    private func requestStop(_ reason: Stop) {
        guard !isFinished, stop == nil else { return }
        stop = reason
        guard hasLaunched, process.isRunning else { return }
        process.terminate()
        let killTimer = DispatchSource.makeTimerSource(queue: queue)
        killTimer.schedule(deadline: .now() + Self.graceAfterStopping)
        killTimer.setEventHandler { [weak self] in self?.killIfStillRunning() }
        self.killTimer = killTimer
        killTimer.resume()
    }

    private func start(_ continuation: CheckedContinuation<PicoProcessOutcome, any Error>) {
        self.continuation = continuation
        guard stop == nil else {
            finish(.failure(CancellationError()))
            return
        }
        process.executableURL = executable
        process.arguments = arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = standardOutput.pipe
        process.standardError = standardError.pipe
        process.terminationHandler = { [weak self] _ in
            guard let self else { return }
            queue.async { self.processEnded() }
        }
        do {
            try process.run()
        } catch {
            finish(.failure(PicoProcessFailure.cannotStart(error)))
            return
        }
        hasLaunched = true
        standardOutput.begin(on: queue)
        standardError.begin(on: queue)
        startDeadline()
    }

    private func startDeadline() {
        guard timeout > 0 else { return }
        let deadlineTimer = DispatchSource.makeTimerSource(queue: queue)
        deadlineTimer.schedule(deadline: .now() + timeout)
        deadlineTimer.setEventHandler { [weak self] in self?.requestStop(.deadline) }
        self.deadlineTimer = deadlineTimer
        deadlineTimer.resume()
    }
}

extension PicoProcessRun {
    fileprivate enum Stop {
        case cancelled
        case deadline
    }
}

private final class PicoPipeDrain {
    let pipe = Pipe()
    private(set) var collected = Data()

    private var isClosed = false
    private let retention: Retention
    private var scratch = [UInt8](repeating: 0, count: 64 * 1024)
    private var source: (any DispatchSourceRead)?

    init(retention: Retention) {
        self.retention = retention
    }

    func begin(on queue: DispatchQueue) {
        guard !isClosed else { return }
        let handle = pipe.fileHandleForReading
        let descriptor = handle.fileDescriptor
        _ = fcntl(descriptor, F_SETFL, fcntl(descriptor, F_GETFL) | O_NONBLOCK)
        let source = DispatchSource.makeReadSource(fileDescriptor: descriptor, queue: queue)
        source.setEventHandler { [weak self] in self?.drainAvailable() }
        // Closing an active dispatch source's descriptor can race its pending read.
        source.setCancelHandler { try? handle.close() }
        self.source = source
        source.resume()
    }

    func close() {
        guard !isClosed else { return }
        isClosed = true
        source?.cancel()
        source = nil
    }

    func drainAvailable() {
        guard !isClosed else { return }
        let descriptor = pipe.fileHandleForReading.fileDescriptor
        for _ in 0..<16 {
            let count = scratch.withUnsafeMutableBytes {
                read(descriptor, $0.baseAddress, $0.count)
            }
            if count > 0 {
                collect(count)
            } else if count == 0 {
                close()
                return
            } else if errno == EINTR {
                continue
            } else if errno == EAGAIN || errno == EWOULDBLOCK {
                return
            } else {
                close()
                return
            }
        }
    }

    private func collect(_ count: Int) {
        switch retention {
        case .all:
            collected.append(contentsOf: scratch[..<count])
        case .last(let limit):
            collected.append(contentsOf: scratch[..<count])
            if collected.count > limit { collected.removeFirst(collected.count - limit) }
        }
    }
}

extension PicoPipeDrain {
    enum Retention {
        case all
        case last(Int)
    }
}
