import Darwin
import Foundation
import Testing

@testable import Pico

@Suite("pico runtime client")
struct PicoRuntimeClientTests {
    @Test("install cannot grant formula trust implicitly before separate approval")
    func firstInstallRequiresSeparateTrust() async throws {
        let homebrew = try FakeHomebrew(isTapTrusted: false, installed: nil)
        defer { homebrew.remove() }
        let client = homebrew.client()
        await #expect(throws: PicoCommandError.self) {
            try await client.perform(.install)
        }
        #expect(try await client.inspectFormula() == .tapNotTrusted)
        #expect(!FileManager.default.fileExists(atPath: homebrew.directory.file("installed").path))
    }

    @Test("checks and upgrades use the Homebrew installation owning the resolved Pico")
    func selectsTheOwningHomebrewPrefix() async throws {
        let first = try FakeHomebrew(installed: nil)
        defer { first.remove() }
        let second = try FakeHomebrew(stable: "0.2.0", installed: "0.1.0")
        defer { second.remove() }
        let client = PicoRuntimeClient(
            executableOverride: nil,
            candidates: [
                first.directory.file("bin/pico").path, second.directory.file("bin/pico").path,
            ],
            homebrew: .candidates([
                first.directory.file("bin/brew").path, second.directory.file("bin/brew").path,
            ])
        )
        #expect(try client.locate().isHomebrewManaged)
        #expect(try await client.inspectFormula() == .formula(.fixture(stable: "0.2.0")))

        try await client.perform(.upgrade)

        #expect(try client.locate().path == second.directory.file("bin/pico").path)
        #expect(try await client.version(of: client.locate()) == "0.2.0")
        #expect(!FileManager.default.fileExists(atPath: first.directory.file("installed").path))
    }

    @Test(
        "a pinned keg or its alias is not advertised as following Homebrew upgrades",
        arguments: ["Cellar/pico/0.1.0/bin/pico", "pico-alias"]
    )
    func pinnedExecutablesRemainCustom(path: String) async throws {
        let homebrew = try FakeHomebrew(stable: "0.2.0", installed: "0.1.0")
        defer { homebrew.remove() }
        let keg = homebrew.directory.file("Cellar/pico/0.1.0/bin/pico")
        try FileManager.default.createSymbolicLink(
            at: homebrew.directory.file("pico-alias"),
            withDestinationURL: keg
        )
        let selected = homebrew.client(executableOverride: homebrew.directory.file(path).path)
        #expect(try selected.locate().isHomebrewManaged == false)

        try await homebrew.client().perform(.upgrade)

        #expect(try await selected.version(of: selected.locate()) == "0.1.0")
    }

    @Test("the running version is the one the command's schema reports")
    func readsTheVersionFromTheSchema() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script(
            "pico",
            #"printf '{"apiVersion":1,"version":"0.3.0","commands":[]}'"#
        )
        let client = PicoRuntimeClient(executableOverride: pico.path, homebrew: .fixed(nil))

        let version = try await client.version(of: client.locate())

        #expect(version == "0.3.0")
    }

    @Test("a schema document without a version is refused instead of read as an empty one")
    func refusesASchemaWithoutAVersion() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script("pico", #"printf '{"apiVersion":1,"commands":[]}'"#)
        let client = PicoRuntimeClient(executableOverride: pico.path, homebrew: .fixed(nil))
        let location = try client.locate()

        let failure = await #expect(throws: PicoCommandError.self) {
            try await client.version(of: location)
        }

        #expect(failure?.message.contains(pico.path) == true)
    }

    @Test("installed versions are what the command's version get reports")
    func readsTheInstalledVersions() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script(
            "pico",
            #"""
            [ "$1 $2" = "version get" ] || exit 2
            printf '{"apiVersion":1,"item":{"pico":"0.3.0","omp":"18.14.0"}}'
            """#
        )
        let client = PicoRuntimeClient(executableOverride: pico.path, homebrew: .fixed(nil))

        let versions = try await client.installedVersions(of: client.locate())

        #expect(versions == InstalledVersions(pico: "0.3.0", omp: "18.14.0"))
    }

    @Test("an answer missing a version is refused instead of shown as an empty one")
    func refusesAnAnswerWithoutBothVersions() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script(
            "pico",
            #"printf '{"apiVersion":1,"item":{"pico":"0.3.0","omp":""}}'"#
        )
        let client = PicoRuntimeClient(executableOverride: pico.path, homebrew: .fixed(nil))
        let location = try client.locate()

        let failure = await #expect(throws: PicoCommandError.self) {
            try await client.installedVersions(of: location)
        }

        #expect(failure?.message.contains(pico.path) == true)
    }

    @Test("the formula's published version and the keg Homebrew has linked are read")
    func readsTheFormula() async throws {
        let homebrew = try FakeHomebrew(stable: "0.2.0", installed: "0.1.0")
        defer { homebrew.remove() }

        let inspection = try await homebrew.client().inspectFormula()

        #expect(
            inspection
                == .formula(
                    HomebrewFormula(
                        installedVersions: ["0.1.0"],
                        isOutdated: false,
                        linkedVersion: "0.1.0",
                        packageVersion: "0.2.0",
                        stableVersion: "0.2.0"
                    )
                )
        )
    }

    @Test("a formula Homebrew has not installed has no keg")
    func readsAFormulaThatIsNotInstalled() async throws {
        let homebrew = try FakeHomebrew(installed: nil)
        defer { homebrew.remove() }

        let inspection = try await homebrew.client().inspectFormula()

        #expect(inspection == .formula(.fixture(installed: [], linked: nil)))
    }

    @Test("an answer about another formula is refused, so no other pico can report current")
    func refusesAnotherFormula() async throws {
        let homebrew = try FakeHomebrew()
        defer { homebrew.remove() }
        try homebrew.answers(
            info: #"""
                {"formulae":[{"name":"pico","full_name":"homebrew/core/pico","tap":"homebrew/core","versions":{"stable":"5.09"},"revision":0,"installed":[],"linked_keg":null,"outdated":false}],"casks":[]}
                """#
        )

        let failure = await #expect(throws: PicoCommandError.self) {
            try await homebrew.client().inspectFormula()
        }

        #expect(failure?.message.contains("markmals/tap/pico") == true)
    }

    @Test("an empty answer is refused rather than read as a missing formula")
    func refusesAnEmptyAnswer() async throws {
        let homebrew = try FakeHomebrew()
        defer { homebrew.remove() }
        try homebrew.answers(info: #"{"formulae":[],"casks":[]}"#)

        await #expect(throws: PicoCommandError.self) {
            try await homebrew.client().inspectFormula()
        }
    }

    @Test("an untrusted tap is reported as such, and trusting it is what makes it readable")
    func trustingTheTapMakesTheFormulaReadable() async throws {
        let homebrew = try FakeHomebrew(isTapTrusted: false)
        defer { homebrew.remove() }
        let client = homebrew.client()
        #expect(try await client.inspectFormula() == .tapNotTrusted)

        try await client.perform(.trustTap)

        #expect(try await client.inspectFormula() != .tapNotTrusted)
    }

    @Test("a Homebrew older than Pico's install instructions support is reported as that")
    func reportsAnUnsupportedHomebrew() async throws {
        let homebrew = try FakeHomebrew(version: "5.1.15")
        defer { homebrew.remove() }

        let inspection = try await homebrew.client().inspectFormula()

        #expect(inspection == .unsupported("5.1.15"))
    }

    @Test("checking the formula never refreshes the metadata a refresh brings in")
    func onlyARefreshBringsInANewerVersion() async throws {
        let homebrew = try FakeHomebrew(stable: "0.1.0", installed: "0.1.0", published: "0.2.0")
        defer { homebrew.remove() }
        let client = homebrew.client()

        let before = try await client.inspectFormula()
        try await client.refreshFormula()
        let after = try await client.inspectFormula()

        #expect(before == .formula(.fixture()))
        #expect(
            after
                == .formula(
                    HomebrewFormula(
                        installedVersions: ["0.1.0"],
                        isOutdated: false,
                        linkedVersion: "0.1.0",
                        packageVersion: "0.2.0",
                        stableVersion: "0.2.0"
                    )
                )
        )
    }

    @Test("installing the formula leaves a linked command Pico resolves and runs")
    func installingLeavesARunnableCommand() async throws {
        let homebrew = try FakeHomebrew(stable: "0.1.0", installed: nil)
        defer { homebrew.remove() }
        let client = homebrew.client()
        #expect(throws: PicoCommandError.self) { try client.locate() }

        try await client.perform(.install)

        let location = try client.locate()
        #expect(location.path == homebrew.directory.file("bin/pico").path)
        #expect(location.isHomebrewManaged)
        #expect(try await client.version(of: location) == "0.1.0")
        #expect(try await client.inspectFormula() == .formula(.fixture()))
    }

    @Test("reinstall restores a missing link to an installed Pico keg")
    func reinstallRestoresTheCommandLink() async throws {
        let homebrew = try FakeHomebrew()
        defer { homebrew.remove() }
        try FileManager.default.removeItem(at: homebrew.directory.file("bin/pico"))
        let client = homebrew.client()
        #expect(throws: PicoCommandError.self) { try client.locate() }
        #expect(try await client.inspectFormula() == .formula(.fixture(linked: nil)))

        try await client.perform(.reinstall)

        #expect(try await client.version(of: client.locate()) == "0.1.0")
        #expect(try await client.inspectFormula() == .formula(.fixture()))
    }

    @Test("upgrading links the published version, which the command then reports")
    func upgradingReplacesTheLinkedKeg() async throws {
        let homebrew = try FakeHomebrew(stable: "0.2.0", installed: "0.1.0")
        defer { homebrew.remove() }
        let client = homebrew.client()

        try await client.perform(.upgrade)

        #expect(
            try await client.inspectFormula()
                == .formula(.fixture(stable: "0.2.0", installed: ["0.2.0"], linked: "0.2.0"))
        )
        #expect(try await client.version(of: client.locate()) == "0.2.0")
    }

    @Test("Homebrew runs without cleanup, automatic updates, sudo, prompts or an inherited PATH")
    func runsHomebrewSafely() async throws {
        let homebrew = try FakeHomebrew()
        defer { homebrew.remove() }

        try await homebrew.client().perform(.upgrade)

        let environment = try homebrew.environment()
        #expect(environment["HOMEBREW_NO_INSTALL_CLEANUP"] == "1")
        #expect(environment["HOMEBREW_NO_AUTOREMOVE"] == "1")
        #expect(environment["HOMEBREW_NO_AUTO_UPDATE"] == "1")
        #expect(environment["HOMEBREW_NO_SUDO"] == "1")
        #expect(environment["HOMEBREW_NO_ASK"] == "1")
        #expect(environment["HOMEBREW_NO_ANALYTICS"] == "1")
        #expect(environment["HOMEBREW_NO_ENV_HINTS"] == "1")
        #expect(environment["HOMEBREW_NO_COLOR"] == "1")
        #expect(
            environment["PATH"]
                == "\(homebrew.prefix.path)/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        )
        #expect(environment["HOME"] == ProcessInfo.processInfo.environment["HOME"])
    }

    @Test("a Homebrew command that fails reports what it printed")
    func reportsAFailedHomebrewCommand() async throws {
        let homebrew = try FakeHomebrew()
        defer { homebrew.remove() }
        try homebrew.fails(with: "Error: Permission denied @ rb_sysopen")

        let failure = await #expect(throws: PicoCommandError.self) {
            try await homebrew.client().perform(.upgrade)
        }

        #expect(failure?.message.contains("Permission denied") == true)
    }

    @Test("without a Homebrew executable there is no Homebrew, and its commands say so")
    func reportsHomebrewUnavailable() async throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let client = PicoRuntimeClient(
            executableOverride: try directory.script("pico", "exit 0").path,
            homebrew: .candidates([directory.file("brew").path])
        )

        #expect(client.isHomebrewAvailable == false)
        await #expect(throws: PicoCommandError.self) { try await client.refreshFormula() }
        await #expect(throws: PicoCommandError.self) { try await client.inspectFormula() }
        await #expect(throws: PicoCommandError.self) { try await client.perform(.install) }
    }

    @Test("Homebrew installed after Pico started is found by the next operation")
    func findsHomebrewInstalledLater() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        try FileManager.default.createDirectory(
            at: directory.file("bin"),
            withIntermediateDirectories: true
        )
        let client = PicoRuntimeClient(
            executableOverride: try directory.script("pico", "exit 0").path,
            homebrew: .candidates([directory.file("bin/brew").path])
        )
        #expect(client.isHomebrewAvailable == false)

        try directory.script("bin/brew", "exit 0")

        #expect(client.isHomebrewAvailable)
    }

    @Test("Homebrew's prefix is the directory its executable sits in, not a shell's idea of it")
    func readsThePrefixFromTheExecutable() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        try FileManager.default.createDirectory(
            at: directory.file("bin"),
            withIntermediateDirectories: true
        )
        let brew = try directory.script("bin/brew", "exit 0")

        let homebrew = try #require(HomebrewCommand.installed(candidates: [brew.path]))

        #expect(homebrew.prefix.path == directory.url.path)
        #expect(homebrew.executable.path == brew.path)
    }

    @Test("a command chosen with -PicoExecutable is not Homebrew's, wherever it sits")
    func refusesToClaimAnOverride() async throws {
        let homebrew = try FakeHomebrew()
        defer { homebrew.remove() }
        let other = try homebrew.directory.script("bin/pico-dev", "exit 0")
        let client = homebrew.client(executableOverride: other.path)

        let location = try client.locate()

        #expect(location.path == other.path)
        #expect(location.isHomebrewManaged == false)
    }

    @Test("a command left at Homebrew's own path that it did not install is not Homebrew's")
    func refusesToClaimACommandHomebrewDidNotInstall() async throws {
        let homebrew = try FakeHomebrew(installed: nil)
        defer { homebrew.remove() }
        // A development build copied over Homebrew's path: a real file, not a link to a keg.
        try homebrew.directory.script("bin/pico", "exit 0")

        let location = try homebrew.client().locate()

        #expect(location.path == homebrew.directory.file("bin/pico").path)
        #expect(location.isHomebrewManaged == false)
    }

    @Test("without Homebrew, no command is Homebrew's")
    func claimsNothingWithoutHomebrew() throws {
        let directory = try TemporaryTestDirectory()
        defer { directory.remove() }
        let pico = try directory.script("pico", "exit 0")
        let client = PicoRuntimeClient(executableOverride: pico.path, homebrew: .fixed(nil))

        #expect(try client.locate().isHomebrewManaged == false)
    }

    @Test(
        "reinstall refuses an active Pico keg even when its command link is missing",
        .timeLimit(.minutes(1))
    )
    func protectsAnUnlinkedRunningKeg() async throws {
        let homebrew = try FakeHomebrew(installed: nil)
        defer { homebrew.remove() }
        let executable = homebrew.directory.file("Cellar/pico/0.1.0/bin/pico")
        try FileManager.default.createDirectory(
            at: executable.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.copyItem(at: URL(fileURLWithPath: "/bin/sleep"), to: executable)
        let running = Process()
        let completion = AsyncStream<Void>.makeStream()
        running.terminationHandler = { _ in
            completion.continuation.yield(())
            completion.continuation.finish()
        }
        running.executableURL = executable
        running.arguments = ["30"]
        try running.run()
        let failure = await #expect(throws: PicoCommandError.self) {
            try await homebrew.client().perform(.reinstall)
        }
        #expect(failure?.message.contains(executable.resolvingSymlinksInPath().path) == true)
        #expect(!FileManager.default.fileExists(atPath: homebrew.directory.file("installed").path))
        kill(running.processIdentifier, SIGTERM)
        for await _ in completion.stream { break }
    }

    @Test("cancelling a package action stops Homebrew instead of leaving it running")
    func cancellingStopsHomebrew() async throws {
        let homebrew = try FakeHomebrew()
        defer { homebrew.remove() }
        let recorded = homebrew.directory.file("brew.pid")
        try homebrew.directory.script(
            "bin/brew",
            """
            printf '%s' "$$" > \(recorded.path)
            sleep 30
            """
        )
        let client = homebrew.client()
        let action = Task { try await client.perform(.upgrade) }
        let identifier = try #require(await recordedProcessIdentifier(at: recorded))

        action.cancel()

        await #expect(throws: CancellationError.self) { try await action.value }
        #expect(await hasStopped(identifier))
    }

    @Test("cancelling stops a program Homebrew started that ignores being asked to stop")
    func cancellingStopsAStubbornChild() async throws {
        let homebrew = try FakeHomebrew()
        defer { homebrew.remove() }
        let recorded = homebrew.directory.file("child.pid")
        try homebrew.directory.script(
            "bin/brew",
            """
            /bin/sh -c 'trap "" TERM; sleep 30' &
            printf '%s' "$!" > \(recorded.path)
            trap 'exit 0' TERM
            wait
            """
        )
        let client = homebrew.client()
        let action = Task { try await client.perform(.install) }
        let identifier = try #require(await recordedProcessIdentifier(at: recorded))

        action.cancel()

        await #expect(throws: CancellationError.self) { try await action.value }
        #expect(await hasStopped(identifier))
    }

    @Test("an answer larger than Pico reads is refused, never parsed as a whole one")
    func refusesAnAnswerThatIsTooLarge() async throws {
        let homebrew = try FakeHomebrew()
        defer { homebrew.remove() }
        // Five mebibytes of padding inside a formula document Pico would otherwise read.
        try homebrew.directory.script(
            "bin/brew",
            #"""
            root=$(dirname "$(dirname "$0")")
            case "$1 $2" in
                "trust --json") printf '{"taps":["markmals/tap"],"formulae":[],"casks":[]}' ;;
                "info --json=v2")
                    printf '{"formulae":[{"full_name":"markmals/tap/pico","desc":"'
                    head -c 5242880 /dev/zero | tr '\0' 'x'
                    printf '"}],"casks":[]}'
                    ;;
            esac
            """#
        )

        let failure = await #expect(throws: PicoCommandError.self) {
            try await homebrew.client().inspectFormula()
        }

        #expect(failure?.message.contains("brew info") == true)
    }

}

/// A Homebrew installation made of scripts. Its `brew` answers from state it keeps on disk
/// and changes the way the real one does: trusting the tap makes the formula readable,
/// refreshing brings in a newer published version, and installing links a keg with a `pico`
/// in it. Tests watch those changes rather than the arguments Pico passed.
struct FakeHomebrew {
    let directory: TemporaryTestDirectory

    init(
        isTapTrusted: Bool = true,
        stable: String = "0.1.0",
        installed: String? = "0.1.0",
        published: String? = nil,
        version: String = "7.0.0"
    ) throws {
        directory = try TemporaryTestDirectory()
        try FileManager.default.createDirectory(
            at: directory.file("bin"),
            withIntermediateDirectories: true
        )
        if isTapTrusted { try directory.text("trusted", "") }
        try directory.text("stable", stable)
        try directory.text("version", version)
        if let published { try directory.text("published", published) }
        if let installed { try install(installed) }
        try directory.script("bin/brew", Self.brew)
    }

    var prefix: URL { directory.url }

    func client(executableOverride: String? = nil) -> PicoRuntimeClient {
        PicoRuntimeClient(
            executableOverride: executableOverride,
            candidates: [directory.file("bin/pico").path],
            homebrew: .fixed(
                HomebrewCommand(executable: directory.file("bin/brew"), prefix: prefix)
            )
        )
    }

    func environment() throws -> [String: String] {
        let text = try String(contentsOf: directory.file("environment"), encoding: .utf8)
        return Dictionary(
            text.split(whereSeparator: \.isNewline).compactMap { line in
                guard let separator = line.firstIndex(of: "=") else { return nil }
                return (String(line[..<separator]), String(line[line.index(after: separator)...]))
            },
            uniquingKeysWith: { first, _ in first }
        )
    }

    /// Replaces `brew` with one that answers `info` with exactly this document.
    func answers(info: String) throws {
        try directory.text("info.json", info)
        try directory.script(
            "bin/brew",
            #"""
            root=$(dirname "$(dirname "$0")")
            case "$1 $2" in
                "trust --json") printf '{"taps":["markmals/tap"],"formulae":[],"casks":[]}' ;;
                "info --json=v2") cat "$root/info.json" ;;
            esac
            """#
        )
    }

    /// Replaces `brew` with one that fails the way a refused command does.
    func fails(with message: String) throws {
        try directory.text("failure", message)
        try directory.script(
            "bin/brew",
            #"""
            root=$(dirname "$(dirname "$0")")
            cat "$root/failure" >&2
            exit 1
            """#
        )
    }

    func remove() {
        directory.remove()
    }

    /// The keg Homebrew pours and the command it links into its prefix.
    private func install(_ version: String) throws {
        let keg = directory.file("Cellar/pico/\(version)/bin")
        try FileManager.default.createDirectory(at: keg, withIntermediateDirectories: true)
        let command = keg.appendingPathComponent("pico", isDirectory: false)
        try "#!/bin/sh\nprintf '{\"apiVersion\":1,\"version\":\"\(version)\"}'\n"
            .write(to: command, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: command.path
        )
        let link = directory.file("bin/pico")
        try? FileManager.default.removeItem(at: link)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: command)
        try directory.text("installed", version)
    }

    private static let brew = #"""
        root=$(dirname "$(dirname "$0")")
        env > "$root/environment"
        stable=$(cat "$root/stable")
        if [ "$1" = "--version" ]; then
            printf 'Homebrew %s\n' "$(cat "$root/version")"
            exit 0
        fi
        case "$1 $2" in
            "trust --json")
                if [ -f "$root/trusted" ]; then
                    printf '{"taps":["markmals/tap"],"formulae":[],"casks":[],"commands":[]}'
                elif [ -f "$root/formula-trusted" ]; then
                    printf '{"taps":[],"formulae":["markmals/tap/pico"],"casks":[],"commands":[]}'
                else
                    printf '{"taps":[],"formulae":[],"casks":[],"commands":[]}'
                fi
                ;;
            "trust --tap")
                : > "$root/trusted"
                ;;
            "update --quiet")
                if [ -f "$root/published" ]; then cp "$root/published" "$root/stable"; fi
                ;;
            "info --json=v2")
                if [ -f "$root/installed" ]; then
                    keg=$(cat "$root/installed")
                    kegs="{\"version\":\"$keg\"}"
                    if [ -x "$root/bin/pico" ]; then linked="\"$keg\""; else linked="null"; fi
                else
                    kegs=""
                    linked="null"
                fi
                printf '{"formulae":[{"name":"pico","full_name":"markmals/tap/pico","tap":"markmals/tap","versions":{"stable":"%s","head":"HEAD"},"revision":0,"installed":[%s],"linked_keg":%s,"outdated":false}],"casks":[]}' "$stable" "$kegs" "$linked"
                ;;
            "install --formula" | "reinstall --formula" | "upgrade --formula")
                if [ "$1" = "install" ] && [ ! -f "$root/trusted" ]; then : > "$root/formula-trusted"; fi
                if [ "$1" = "install" ] && [ -f "$root/installed" ]; then exit 0; fi
                mkdir -p "$root/Cellar/pico/$stable/bin"
                printf '#!/bin/sh\nprintf '"'"'{"apiVersion":1,"version":"%s"}'"'"'\n' "$stable" \
                    > "$root/Cellar/pico/$stable/bin/pico"
                chmod 755 "$root/Cellar/pico/$stable/bin/pico"
                ln -sfh "$root/Cellar/pico/$stable/bin/pico" "$root/bin/pico"
                printf '%s' "$stable" > "$root/installed"
                ;;
        esac
        """#
}
