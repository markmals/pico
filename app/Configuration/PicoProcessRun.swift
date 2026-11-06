import Darwin
import Foundation

struct PicoProcessOutcome: Sendable {
    /// Set when the command printed more than the caller allowed. Whatever was collected is
    /// incomplete, so a caller that reads the output must report the failure rather than it.
    let isOutputTruncated: Bool
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
    private let environment: [String: String]?
    private let executable: URL
    private let process = Process()
    private let queue = DispatchQueue(label: "me.malstrom.pico.command", qos: .userInitiated)
    private let standardError = PicoPipeDrain(retention: .tail(64 * 1024))
    private let standardOutput: PicoPipeDrain
    private let stopsDescendants: Bool
    private let timeout: TimeInterval

    private var continuation: CheckedContinuation<PicoProcessOutcome, any Error>?
    private var deadlineTimer: (any DispatchSourceTimer)?
    private var hasLaunched = false
    private var isFinished = false
    private var killTimer: (any DispatchSourceTimer)?
    private var launchedGroup: pid_t?
    private var stop: Stop?

    /// A nil environment runs the command with the one this process was launched with. An
    /// explicit one replaces it outright, so a command cannot read a shell's PATH or settings.
    ///
    /// Stopping descendants signals the whole process group a stopped command leads, which is
    /// what a command that runs programs of its own, such as Homebrew, needs. Output retention
    /// bounds what a verbose command keeps in memory.
    init(
        executable: URL,
        arguments: [String],
        environment: [String: String]? = nil,
        outputRetention: OutputRetention = .all,
        stopsDescendants: Bool = false,
        timeout: TimeInterval
    ) {
        self.arguments = arguments
        self.environment = environment
        self.executable = executable
        self.standardOutput = PicoPipeDrain(retention: outputRetention)
        self.stopsDescendants = stopsDescendants
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
        if let launchedGroup { kill(-launchedGroup, SIGKILL) }
        kill(process.processIdentifier, SIGKILL)
    }

    private func processEnded() {
        guard !isFinished else { return }
        standardOutput.drainAvailable()
        standardError.drainAvailable()
        // Descendants can outlive their leader; signal the recorded group before returning.
        if stop != nil, let launchedGroup { kill(-launchedGroup, SIGKILL) }
        switch stop {
        case .cancelled:
            finish(.failure(CancellationError()))
        case .deadline:
            finish(.failure(PicoProcessFailure.timedOut))
        case nil:
            let outcome = PicoProcessOutcome(
                isOutputTruncated: standardOutput.isTruncated,
                standardError: standardError.collected,
                standardOutput: standardOutput.collected,
                status: process.terminationStatus
            )
            finish(.success(outcome))
        }
    }

    /// Remembers the process group the command leads, once, while it is still running.
    /// Foundation starts a command in a group of its own, which the programs it starts
    /// inherit. Anything else — a command sharing this app's group — is never recorded, so
    /// Pico can only ever signal a group it started.
    private func recordGroup() {
        guard stopsDescendants else { return }
        let identifier = process.processIdentifier
        let group = getpgid(identifier)
        guard group == identifier, group != getpgrp() else { return }
        launchedGroup = group
    }

    private func requestStop(_ reason: Stop) {
        guard !isFinished, stop == nil else { return }
        stop = reason
        guard hasLaunched, process.isRunning else { return }
        if let launchedGroup { kill(-launchedGroup, SIGTERM) } else { process.terminate() }
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
        if let environment { process.environment = environment }
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
        recordGroup()
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
    /// How much of what a command prints is kept. `all` keeps everything, `bounded` keeps
    /// everything up to a limit and reports the rest as truncated, and `tail` keeps only the
    /// end, for output that is shown rather than read.
    enum OutputRetention: Equatable, Sendable {
        case all
        case bounded(Int)
        case tail(Int)
    }

    fileprivate enum Stop {
        case cancelled
        case deadline
    }
}

private final class PicoPipeDrain {
    let pipe = Pipe()
    private(set) var collected = Data()
    private(set) var isTruncated = false

    private var isClosed = false
    private let retention: PicoProcessRun.OutputRetention
    private var scratch = [UInt8](repeating: 0, count: 64 * 1024)
    private var source: (any DispatchSourceRead)?

    init(retention: PicoProcessRun.OutputRetention) {
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
        case .bounded(let limit):
            // Keep reading past the limit: a full pipe would block the command instead.
            let room = limit - collected.count
            guard room > 0 else {
                isTruncated = true
                return
            }
            collected.append(contentsOf: scratch[..<min(count, room)])
            if count > room { isTruncated = true }
        case .tail(let limit):
            collected.append(contentsOf: scratch[..<count])
            if collected.count > limit { collected.removeFirst(collected.count - limit) }
        }
    }
}
