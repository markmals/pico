import Darwin
import Foundation

/// Where the `pico` command Pico would run sits, and whether it is the one Homebrew installed.
/// Homebrew's is the command its prefix links into a keg of the `pico` formula; anything else,
/// including a file someone left at that path, is not one Homebrew would replace.
struct PicoRuntimeLocation: Equatable, Sendable {
    let path: String
    let isHomebrewManaged: Bool
}

/// Published package metadata, installed kegs, and the keg Homebrew currently links.
struct HomebrewFormula: Equatable, Sendable {
    let installedVersions: [String]
    let isOutdated: Bool
    let linkedVersion: String?
    let packageVersion: String
    let stableVersion: String
}

enum HomebrewInspection: Equatable, Sendable {
    case formula(HomebrewFormula)
    case tapNotTrusted
    /// Homebrew older than the one Pico's install instructions require, which does not have
    /// the commands Pico reads. It carries the version Homebrew reported.
    case unsupported(String)
}

enum HomebrewAction: Equatable, Sendable {
    case install
    case reinstall
    case trustTap
    case upgrade
}

/// Where Homebrew is looked for. Searching resolves it again for every operation, so a user
/// who installs Homebrew and comes back to Pico is seen; a test fixes it instead.
enum HomebrewSource: Sendable {
    case candidates([String])
    case fixed(HomebrewCommand?)

    static let installed = HomebrewSource.candidates(HomebrewCommand.defaultCandidates)

    func resolve(owning pico: URL? = nil) -> HomebrewCommand? {
        switch self {
        case .candidates(let paths): HomebrewCommand.installed(candidates: paths, owning: pico)
        case .fixed(let command): command
        }
    }
}

protocol PicoRuntimeServing: Sendable {
    /// The command the user chose with `-PicoExecutable`, if they chose one. Homebrew cannot
    /// repair a path Pico was told to use, so no package action is offered for it.
    var chosenExecutable: String? { get }
    var isHomebrewAvailable: Bool { get }

    func inspectFormula() async throws -> HomebrewInspection
    func locate() async throws -> PicoRuntimeLocation
    func perform(_ action: HomebrewAction) async throws
    func refreshFormula() async throws
    func version(of location: PicoRuntimeLocation) async throws -> String
}

struct PicoRuntimeClient: PicoRuntimeServing {
    /// What Homebrew prints: an answer Pico reads must arrive whole, and a package command's
    /// progress is only ever shown, so its end is enough.
    private static let answerLimit = PicoProcessRun.OutputRetention.bounded(4 * 1024 * 1024)
    private static let progressLimit = PicoProcessRun.OutputRetention.tail(64 * 1024)

    /// The oldest Homebrew Pico's install instructions support, and the first that can say
    /// which taps it trusts.
    private static let oldestHomebrew = "6.0.0"

    private static let actionTimeout: TimeInterval = 1800
    private static let inspectionTimeout: TimeInterval = 120
    private static let refreshTimeout: TimeInterval = 300

    let candidates: [String]
    let executableOverride: String?
    let homebrew: HomebrewSource

    init(
        executableOverride: String?,
        candidates: [String] = PicoExecutable.homebrewCandidates,
        homebrew: HomebrewSource = .installed
    ) {
        self.candidates = candidates
        self.executableOverride = executableOverride
        self.homebrew = homebrew
    }

    var chosenExecutable: String? { executableOverride }

    var isHomebrewAvailable: Bool { installedHomebrew != nil }

    private var installedHomebrew: HomebrewCommand? {
        let executable = try? PicoExecutable.resolve(
            override: executableOverride,
            candidates: candidates
        )
        return homebrew.resolve(owning: executable)
    }

    /// Reads the formula only from a Homebrew that supports Pico's install instructions, and
    /// only once it trusts the tap the formula comes from. Both are states the user can
    /// recover from, not failures to report as one.
    func inspectFormula() async throws -> HomebrewInspection {
        let homebrew = try requireHomebrew()
        switch try await access(to: homebrew) {
        case .allowed: break
        case .untrusted: return .tapNotTrusted
        case .unsupported(let version): return .unsupported(version)
        }
        let output = try await homebrew.run(
            ["info", "--json=v2", "--formula", HomebrewCommand.formula],
            retention: Self.answerLimit,
            timeout: Self.inspectionTimeout
        )
        return .formula(try formula(from: output))
    }

    func locate() throws -> PicoRuntimeLocation {
        let executable = try PicoExecutable.resolve(
            override: executableOverride,
            candidates: candidates
        )
        return PicoRuntimeLocation(
            path: executable.path,
            isHomebrewManaged: isHomebrewManaged(executable)
        )
    }

    func perform(_ action: HomebrewAction) async throws {
        let homebrew = try requireHomebrew()
        if action != .trustTap { try await requirePackageAccess(homebrew) }
        if action == .reinstall {
            guard let resolved = realpath(homebrew.prefix.path, nil) else {
                throw PicoCommandError(
                    message: String(
                        localized:
                            "Pico couldn't resolve the Homebrew installation at \(homebrew.prefix.path). Reinstall was not started."
                    )
                )
            }
            defer { free(resolved) }
            // proc_pidpath uses POSIX paths; URL canonicalization can turn /private/var into /var.
            let cellar = String(cString: resolved) + "/Cellar/pico/"
            if let running = try Self.runningExecutable(matching: { $0.hasPrefix(cellar) }) {
                throw PicoCommandError(
                    message: String(
                        localized:
                            "The pico command at \(running) is running. Stop its sessions before reinstalling."
                    )
                )
            }
        }
        _ = try await homebrew.run(
            arguments(for: action),
            retention: Self.progressLimit,
            timeout: Self.actionTimeout
        )
    }

    func refreshFormula() async throws {
        let homebrew = try requireHomebrew()
        _ = try await homebrew.run(
            ["update", "--quiet"],
            retention: Self.progressLimit,
            timeout: Self.refreshTimeout
        )
    }

    func version(of location: PicoRuntimeLocation) async throws -> String {
        let output = try await PicoCommand(executable: URL(fileURLWithPath: location.path))
            .run(["schema"])
        guard let document = try? JSONDecoder().decode(SchemaDocument.self, from: output),
            !document.version.isEmpty
        else {
            throw PicoCommandError(message: .schemaWithoutAVersion(path: location.path))
        }
        return document.version
    }

    private static func runningExecutable(matching matches: (String) -> Bool) throws -> String? {
        let size = Int32(MemoryLayout<pid_t>.size)
        let needed = proc_listpids(UInt32(PROC_ALL_PIDS), 0, nil, 0)
        guard needed > 0 else {
            throw PicoCommandError(
                message: String(
                    localized: "Pico couldn't inspect running commands. Reinstall was not started."
                )
            )
        }
        var identifiers = [pid_t](repeating: 0, count: Int(needed) / Int(size) + 32)
        let written = identifiers.withUnsafeMutableBufferPointer { buffer in
            proc_listpids(UInt32(PROC_ALL_PIDS), 0, buffer.baseAddress, Int32(buffer.count) * size)
        }
        guard written > 0 else {
            throw PicoCommandError(
                message: String(
                    localized: "Pico couldn't inspect running commands. Reinstall was not started."
                )
            )
        }
        // PROC_PIDPATHINFO_MAXSIZE, which Swift does not import, is four times this.
        var scratch = [UInt8](repeating: 0, count: 4 * Int(PATH_MAX))
        for identifier in identifiers.prefix(Int(written) / Int(size)) where identifier > 0 {
            let length = scratch.withUnsafeMutableBytes { buffer in
                proc_pidpath(identifier, buffer.baseAddress, UInt32(buffer.count))
            }
            guard length > 0 else { continue }
            let executable = String(decoding: scratch[..<Int(length)], as: UTF8.self)
            if matches(executable) { return executable }
        }
        return nil
    }

    private func arguments(for action: HomebrewAction) -> [String] {
        switch action {
        case .install: ["install", "--formula", HomebrewCommand.formula]
        case .reinstall: ["reinstall", "--formula", HomebrewCommand.formula]
        case .trustTap: ["trust", "--tap", HomebrewCommand.tap]
        case .upgrade: ["upgrade", "--formula", HomebrewCommand.formula]
        }
    }

    private func formula(from output: Data) throws -> HomebrewFormula {
        guard let document = try? JSONDecoder().decode(InfoDocument.self, from: output),
            let entry = document.formulae.first
        else {
            throw PicoCommandError(message: .unreadableFormula(HomebrewCommand.formula))
        }
        guard entry.fullName == HomebrewCommand.formula, entry.tap == HomebrewCommand.tap else {
            throw PicoCommandError(
                message: .anotherFormula(answered: entry.fullName, asked: HomebrewCommand.formula)
            )
        }
        return HomebrewFormula(
            installedVersions: entry.installed.map(\.version),
            isOutdated: entry.outdated,
            linkedVersion: entry.linkedKeg,
            packageVersion: entry.revision > 0
                ? "\(entry.versions.stable)_\(entry.revision)" : entry.versions.stable,
            stableVersion: entry.versions.stable
        )
    }

    /// The version Homebrew reports, without its name in front of it. An answer Pico cannot
    /// read leaves the version unknown rather than claiming Homebrew is too old.
    private func homebrewVersion(_ homebrew: HomebrewCommand) async throws -> String {
        let output = try await homebrew.run(
            ["--version"],
            retention: Self.answerLimit,
            timeout: Self.inspectionTimeout
        )
        let reported =
            String(decoding: output, as: UTF8.self)
            .split(whereSeparator: \.isNewline)
            .first
            .map(String.init) ?? ""
        return
            reported
            .replacingOccurrences(of: "Homebrew ", with: "")
            .trimmingCharacters(in: .whitespaces)
    }

    /// Homebrew's own `pico` and nothing else: the command has to be the one its prefix links,
    /// and that link has to lead into a keg of the formula. A command someone put at that path,
    /// or a development build pointed at with `-PicoExecutable`, is not Homebrew's to replace.
    private func isHomebrewManaged(_ executable: URL) -> Bool {
        guard let prefix = homebrew.resolve(owning: executable)?.prefix.resolvingSymlinksInPath()
        else {
            return false
        }
        let linked = prefix.appendingPathComponent("bin/pico", isDirectory: false)
        guard executable.standardizedFileURL.path == linked.standardizedFileURL.path else {
            return false
        }
        let resolved = executable.resolvingSymlinksInPath()
        let cellar = prefix.appendingPathComponent("Cellar/pico", isDirectory: true).path
        return resolved.path.hasPrefix("\(cellar)/")
    }

    private func isTapTrusted(_ homebrew: HomebrewCommand) async throws -> Bool {
        let output = try await homebrew.run(
            ["trust", "--json", "v1"],
            retention: Self.answerLimit,
            timeout: Self.inspectionTimeout
        )
        guard let trusted = try? JSONDecoder().decode(TrustDocument.self, from: output) else {
            throw PicoCommandError(message: .unreadableTrust)
        }
        return trusted.taps.contains(HomebrewCommand.tap)
            || trusted.formulae.contains(HomebrewCommand.formula)
    }

    private func access(to homebrew: HomebrewCommand) async throws -> Access {
        let version = try await homebrewVersion(homebrew)
        // Homebrew appends commits-since-release; compatibility follows the release prefix.
        let release = version.split(separator: "-").first.map(String.init) ?? version
        if let reported = RuntimeVersion(release), let oldest = RuntimeVersion(Self.oldestHomebrew),
            reported < oldest
        {
            return .unsupported(version)
        }
        return try await isTapTrusted(homebrew) ? .allowed : .untrusted
    }

    private func requirePackageAccess(_ homebrew: HomebrewCommand) async throws {
        switch try await access(to: homebrew) {
        case .allowed:
            return
        case .untrusted:
            throw PicoCommandError(
                code: "HOMEBREW_TRUST_REQUIRED",
                message: String(
                    localized:
                        "Approve trust for markmals/tap separately before installing or changing Pico."
                )
            )
        case .unsupported(let version):
            throw PicoCommandError(
                code: "HOMEBREW_UNSUPPORTED",
                message: String(
                    localized:
                        "Homebrew \(version) cannot manage Pico here. Use the Homebrew installer to update it first."
                )
            )
        }
    }

    private func requireHomebrew() throws -> HomebrewCommand {
        guard let command = installedHomebrew else {
            throw PicoCommandError(message: .noHomebrew)
        }
        return command
    }
}

extension PicoRuntimeClient {
    private enum Access {
        case allowed
        case untrusted
        case unsupported(String)
    }
}

extension PicoRuntimeClient {
    private struct InfoDocument: Decodable {
        struct Entry: Decodable {
            struct Keg: Decodable {
                let version: String
            }

            struct Versions: Decodable {
                let stable: String
            }

            let fullName: String
            let installed: [Keg]
            let linkedKeg: String?
            let outdated: Bool
            let revision: Int
            let tap: String
            let versions: Versions

            private enum CodingKeys: String, CodingKey {
                case fullName = "full_name"
                case installed
                case linkedKeg = "linked_keg"
                case outdated
                case revision
                case tap
                case versions
            }
        }

        let formulae: [Entry]
    }

    private struct SchemaDocument: Decodable {
        let version: String
    }

    private struct TrustDocument: Decodable {
        let formulae: [String]
        let taps: [String]
    }
}

extension String {
    fileprivate static func anotherFormula(answered: String, asked: String) -> String {
        String(
            localized:
                "Homebrew answered about \(answered) when Pico asked about \(asked), so Pico can't tell whether the command is up to date."
        )
    }

    fileprivate static let noHomebrew = String(
        localized: "Homebrew isn't installed where Pico looks for it, so Pico can't run it."
    )

    fileprivate static func schemaWithoutAVersion(path: String) -> String {
        String(
            localized: "The pico command at \(path) answered without the version it runs."
        )
    }

    fileprivate static func unreadableFormula(_ formula: String) -> String {
        String(localized: "Pico couldn't read what Homebrew reported about \(formula).")
    }

    fileprivate static let unreadableTrust = String(
        localized: "Pico couldn't read which taps and formulae Homebrew trusts."
    )
}
