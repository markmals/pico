import Foundation
import Testing

@testable import Pico

@MainActor
@Suite("installed versions")
struct InstalledVersionsTests {
    @Test("a check reads pico's and its engine's versions from the command it found")
    func readsTheInstalledVersions() async {
        let client = ControlledRuntimeClient()
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value

        #expect(readiness.versions == .read(InstalledVersions(pico: "0.1.0", omp: "18.14.0")))
    }

    @Test("versions that cannot be read show the command's cause, and the command still starts")
    func reportsAFailedRead() async {
        let cause = #"pico has no command "version get""#
        let client = ControlledRuntimeClient(
            installedVersions: .failure(PicoCommandError(message: cause))
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value

        #expect(readiness.versions == .failed(cause))
        #expect(readiness.startup == .starts("0.1.0"))
    }

    @Test("without a command, the versions carry why it wasn't found and nothing is run")
    func reportsAMissingCommand() async {
        let client = ControlledRuntimeClient(
            location: .failure(PicoCommandError(message: "Pico couldn't find the pico command."))
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value

        #expect(readiness.versions == .failed("Pico couldn't find the pico command."))
        #expect(await client.installedVersionReads == 0)
    }

    @Test("a Homebrew upgrade reads the versions of the command it installed")
    func rereadsAfterAnUpgrade() async {
        let client = ControlledRuntimeClient()
        let readiness = RuntimeReadiness(client: client)
        await readiness.check().value
        await client.installs("0.2.0")

        await readiness.perform(.upgrade)?.value

        #expect(readiness.versions == .read(InstalledVersions(pico: "0.2.0", omp: "18.14.0")))
    }

    @Test("cancelling a check keeps the versions last read rather than leaving them checking")
    func cancellationKeepsTheLastRead() async throws {
        let client = ControlledRuntimeClient()
        let readiness = RuntimeReadiness(client: client)
        await readiness.check().value
        await client.hold()
        let checking = readiness.check()
        try await client.waitForLocations(2)

        let stopping = try #require(readiness.cancel())

        #expect(readiness.versions == .read(InstalledVersions(pico: "0.1.0", omp: "18.14.0")))
        await client.release()
        await stopping.value
        await checking.value
    }
}
