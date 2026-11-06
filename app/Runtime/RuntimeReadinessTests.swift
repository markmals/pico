import Foundation
import Testing

@testable import Pico

@MainActor
@Suite("runtime readiness")
struct RuntimeReadinessTests {
    @Test("an explicit update check observes a command replaced outside the app")
    func refreshesTheLocalVersionDuringUpdateCheck() async {
        let client = ControlledRuntimeClient(
            version: .success("0.1.0"),
            inspection: .success(.fixedFormula(stable: "0.2.0", keg: "0.2.0"))
        )
        let readiness = RuntimeReadiness(client: client)
        await readiness.check().value
        await client.reports("0.2.0")
        await readiness.checkForUpdates()?.value
        #expect(readiness.startup == .starts("0.2.0"))
        #expect(readiness.updates == .current("0.2.0"))
        #expect(readiness.recovery == nil)
    }

    @Test(
        "cancelling an update check retains a verdict only for an unchanged command",
        arguments: [false, true]
    )
    func cancellationKeepsOnlyAValidVerdict(commandChanged: Bool) async throws {
        let client = ControlledRuntimeClient()
        let readiness = RuntimeReadiness(client: client)
        await readiness.check().value
        await readiness.checkForUpdates()?.value
        if commandChanged { await client.reports("0.2.0") }
        await client.holdNextInspection()
        let checking = try #require(readiness.checkForUpdates())
        do {
            try await client.waitForInspections(2)
            let stopping = try #require(readiness.cancel())
            #expect(readiness.startup == .starts(commandChanged ? "0.2.0" : "0.1.0"))
            #expect(readiness.updates == (commandChanged ? .notChecked : .current("0.1.0")))
            await client.release()
            await stopping.value
        } catch {
            readiness.cancel()
            await client.release()
            await checking.value
            await readiness.cancelAndWait()
            throw error
        }
    }

    @Test("a missing command is reported with its cause, and nothing is run from it")
    func reportsAMissingCommand() async throws {
        let client = ControlledRuntimeClient(
            location: .failure(PicoCommandError(message: "Pico couldn't find the pico command."))
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value

        #expect(readiness.installation == .missing("Pico couldn't find the pico command."))
        #expect(readiness.startup == .unknown)
        #expect(await client.versions == 0)
        #expect(readiness.recovery == .install)
    }

    @Test("a command that answers the schema reports where it is and which version it runs")
    func reportsTheRunningVersion() async throws {
        let client = ControlledRuntimeClient(version: .success("0.1.0"))
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value

        #expect(readiness.installation == .installed("/opt/homebrew/bin/pico"))
        #expect(readiness.startup == .starts("0.1.0"))
        #expect(readiness.recovery == nil)
        #expect(readiness.isBusy == false)
    }

    @Test("checking readiness never refreshes Homebrew or reads the formula")
    func checksWithoutHomebrew() async throws {
        let client = ControlledRuntimeClient()
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value

        #expect(readiness.updates == .notChecked)
        #expect(await client.refreshes == 0)
        #expect(await client.inspections == 0)
    }

    @Test("a command that is installed but cannot start reports the cause and keeps its location")
    func reportsAStartupFailure() async throws {
        let client = ControlledRuntimeClient(
            version: .failure(PicoCommandError(message: "The pico command ended with status 1."))
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value

        #expect(readiness.installation == .installed("/opt/homebrew/bin/pico"))
        #expect(readiness.startup == .failed("The pico command ended with status 1."))
        #expect(readiness.recovery == .reinstall)
    }

    @Test("without Homebrew, an update check says so instead of running anything")
    func reportsHomebrewUnavailable() async throws {
        let client = ControlledRuntimeClient(isHomebrewAvailable: false)
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .homebrewUnavailable)
        #expect(await client.refreshes == 0)
        #expect(await client.inspections == 0)
        #expect(readiness.recovery == .installHomebrew)
    }

    @Test("Homebrew installed while Pico is open is seen by the next check")
    func seesHomebrewInstalledLater() async throws {
        let client = ControlledRuntimeClient(
            isHomebrewAvailable: false,
            location: .failure(PicoCommandError(message: "Pico couldn't find the pico command."))
        )
        let readiness = RuntimeReadiness(client: client)
        await readiness.check().value
        #expect(readiness.recovery == .installHomebrew)

        client.setHomebrewAvailable(true)
        await readiness.check().value

        #expect(readiness.isHomebrewAvailable)
        #expect(readiness.recovery == .install)
    }

    @Test("a refresh that fails reports its cause and never claims the command is current")
    func refusesToReportCurrentAfterAFailedRefresh() async throws {
        let client = ControlledRuntimeClient()
        await client.failRefresh(PicoCommandError(message: "Could not reach github.com."))
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .failed("Could not reach github.com."))
        #expect(await client.inspections == 0)
    }

    @Test("a formula that cannot be read reports what Homebrew printed")
    func reportsAFailedInspection() async throws {
        let client = ControlledRuntimeClient()
        await client.failInspection(PicoCommandError(message: "Error: No available formula."))
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .failed("Error: No available formula."))
    }

    @Test("a formula Homebrew has not installed offers installing it")
    func reportsAFormulaThatIsNotInstalled() async throws {
        let client = ControlledRuntimeClient(
            inspection: .success(.formula(.fixture(stable: "0.2.0", installed: [], linked: nil)))
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .notInstalled("0.2.0"))
        #expect(readiness.recovery == .install)
    }

    @Test("an installed but unlinked command offers reinstall rather than an ineffective install")
    func repairsAnUnlinkedCommand() async {
        let client = ControlledRuntimeClient(
            location: .failure(PicoCommandError(message: "The pico link is missing")),
            inspection: .success(.formula(.fixture(installed: ["0.1.0"], linked: nil)))
        )
        let readiness = RuntimeReadiness(client: client)
        await readiness.check().value
        await readiness.checkForUpdates()?.value
        #expect(readiness.recovery == .reinstall)
    }

    @Test("a published version newer than the installed keg is an update")
    func reportsAnAvailableUpdate() async throws {
        let client = ControlledRuntimeClient(
            version: .success("0.1.0"),
            inspection: .success(
                .fixedFormula(stable: "0.2.0", keg: "0.1.0")
            )
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .available("0.1.0", "0.2.0"))
        #expect(readiness.recovery == .upgrade)
    }

    @Test("a new formula revision of the same version is an update")
    func reportsARevisionUpdate() async throws {
        let client = ControlledRuntimeClient(
            version: .success("0.1.0"),
            inspection: .success(
                .formula(
                    .fixture(
                        stable: "0.1.0",
                        package: "0.1.0_1",
                        installed: ["0.1.0"],
                        linked: "0.1.0"
                    )
                )
            )
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .available("0.1.0", "0.1.0_1"))
    }

    @Test("a revised keg the command cannot report is current, not a development build")
    func readsARevisedKegAsCurrent() async throws {
        let client = ControlledRuntimeClient(
            version: .failure(PicoCommandError(message: "The pico command ended with status 1.")),
            inspection: .success(
                .formula(
                    .fixture(
                        stable: "0.1.0",
                        package: "0.1.0_1",
                        installed: ["0.1.0_1"],
                        linked: "0.1.0_1"
                    )
                )
            )
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .current("0.1.0_1"))
    }

    @Test("a running version that matches the published one is current")
    func reportsACurrentVersion() async throws {
        let client = ControlledRuntimeClient(
            version: .success("0.1.0"),
            inspection: .success(.fixedFormula(stable: "0.1.0", keg: "0.1.0"))
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .current("0.1.0"))
        #expect(readiness.recovery == nil)
    }

    @Test("a running version ahead of the published one is a development command, not an update")
    func reportsADevelopmentVersion() async throws {
        let client = ControlledRuntimeClient(
            version: .success("0.2.0"),
            inspection: .success(.fixedFormula(stable: "0.1.0", keg: "0.1.0"))
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .development("0.2.0", "0.1.0"))
        #expect(readiness.recovery == nil)
    }

    @Test("a command chosen with -PicoExecutable is never reported as the Homebrew installation")
    func keepsAnOverrideOutOfHomebrewsHands() async throws {
        let client = ControlledRuntimeClient(
            chosenExecutable: "/tmp/pico-tests/pico",
            location: .success(.custom),
            version: .success("0.0.1"),
            inspection: .success(.fixedFormula(stable: "0.2.0", keg: "0.2.0"))
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .custom("/tmp/pico-tests/pico", "0.2.0"))
        #expect(readiness.recovery == nil)
    }

    @Test("a chosen command that is missing is not something Homebrew can install")
    func offersNothingForAMissingChosenCommand() async throws {
        let client = ControlledRuntimeClient(
            chosenExecutable: "/tmp/pico-tests/dev/pico",
            location: .failure(PicoCommandError(message: "There is no executable file there.")),
            inspection: .success(.fixedFormula(stable: "0.2.0", keg: "0.2.0"))
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        #expect(readiness.recovery == nil)

        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .custom("/tmp/pico-tests/dev/pico", "0.2.0"))
        #expect(readiness.recovery == nil)
    }

    @Test("an untrusted tap is its own state, with trusting it as the recovery")
    func reportsAnUntrustedTap() async throws {
        let client = ControlledRuntimeClient(inspection: .success(.tapNotTrusted))
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .tapNotTrusted)
        #expect(readiness.recovery == .trustTap)
    }

    @Test("a Homebrew too old to read is its own state, recovered with Homebrew's installer")
    func reportsAnUnsupportedHomebrew() async throws {
        let client = ControlledRuntimeClient(inspection: .success(.unsupported("5.1.15")))
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .homebrewUnsupported("5.1.15"))
        #expect(readiness.recovery == .installHomebrew)
    }

    @Test("trusting the tap comes before installing, which could not succeed without it")
    func offersTrustBeforeInstalling() async throws {
        let client = ControlledRuntimeClient(
            location: .failure(PicoCommandError(message: "Pico couldn't find the pico command.")),
            inspection: .success(.tapNotTrusted)
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.installation == .missing("Pico couldn't find the pico command."))
        #expect(readiness.recovery == .trustTap)
    }

    @Test("a package action is followed by a real check of what is installed")
    func checksTheInstallationAfterAnAction() async throws {
        let client = ControlledRuntimeClient(
            version: .success("0.1.0"),
            inspection: .success(.fixedFormula(stable: "0.2.0", keg: "0.1.0"))
        )
        await client.installs("0.2.0")
        let readiness = RuntimeReadiness(client: client)
        await readiness.check().value
        await readiness.checkForUpdates()?.value

        await readiness.perform(.upgrade)?.value

        #expect(await client.actions == [.upgrade])
        #expect(readiness.startup == .starts("0.2.0"))
        #expect(readiness.updates == .current("0.2.0"))
    }

    @Test("a package action never refreshes Homebrew's metadata by itself")
    func keepsRefreshesExplicit() async throws {
        let client = ControlledRuntimeClient()
        let readiness = RuntimeReadiness(client: client)

        await readiness.perform(.install)?.value

        #expect(await client.refreshes == 0)
        #expect(await client.inspections == 1)
    }

    @Test("a package action that fails reports its cause and claims no success")
    func reportsAFailedAction() async throws {
        let client = ControlledRuntimeClient(
            version: .failure(PicoCommandError(message: "The pico command ended with status 1.")),
            inspection: .success(.formula(.fixture(stable: "0.2.0", installed: [], linked: nil)))
        )
        await client.failAction(PicoCommandError(message: "Error: Permission denied."))
        let readiness = RuntimeReadiness(client: client)

        await readiness.perform(.install)?.value

        #expect(readiness.actionFailure == "Error: Permission denied.")
        #expect(readiness.updates == .notInstalled("0.2.0"))
        #expect(readiness.startup == .failed("The pico command ended with status 1."))
    }

    @Test("checking again clears the failure the last action reported")
    func clearsAFailureOnTheNextCheck() async throws {
        let client = ControlledRuntimeClient()
        await client.failAction(PicoCommandError(message: "Error: Permission denied."))
        let readiness = RuntimeReadiness(client: client)
        await readiness.perform(.upgrade)?.value
        #expect(readiness.actionFailure == "Error: Permission denied.")

        await readiness.check().value

        #expect(readiness.actionFailure == nil)
    }

    @Test("a command whose version changed forgets what the last update check found")
    func forgetsTheVerdictWhenTheCommandChanges() async throws {
        let client = ControlledRuntimeClient(
            version: .success("0.1.0"),
            inspection: .success(.fixedFormula(stable: "0.1.0", keg: "0.1.0"))
        )
        let readiness = RuntimeReadiness(client: client)
        await readiness.check().value
        await readiness.checkForUpdates()?.value
        #expect(readiness.updates == .current("0.1.0"))

        await client.reports("0.3.0")
        await readiness.check().value

        #expect(readiness.startup == .starts("0.3.0"))
        #expect(readiness.updates == .notChecked)
    }

    @Test("one package operation at a time: a second request is refused while one runs")
    func refusesOverlappingOperations() async throws {
        let client = ControlledRuntimeClient()
        await client.hold()
        let readiness = RuntimeReadiness(client: client)
        let first = try #require(readiness.perform(.install))
        try await client.waitForActions(1)

        #expect(readiness.isBusy)
        #expect(readiness.perform(.reinstall) == nil)
        #expect(readiness.checkForUpdates() == nil)

        await client.release()
        await first.value
        #expect(await client.actions == [.install])
        #expect(readiness.isBusy == false)
    }

    @Test("a cancelled operation stays busy until the command it started has been reaped")
    func staysBusyUntilTheStoppedWorkEnds() async throws {
        let client = ControlledRuntimeClient()
        await client.hold()
        let readiness = RuntimeReadiness(client: client)
        readiness.perform(.install)
        try await client.waitForActions(1)

        let join = try #require(readiness.cancel())

        #expect(readiness.activity == .stopping)
        #expect(readiness.isBusy)
        #expect(readiness.perform(.upgrade) == nil)
        #expect(readiness.checkForUpdates() == nil)

        await client.release()
        await join.value
        #expect(readiness.isBusy == false)
        #expect(readiness.activity == nil)
        #expect(readiness.updates != .current("0.1.0"))
        #expect(readiness.perform(.upgrade) != nil)
    }

    @Test("cancelling a check leaves the last state Pico observed, not a row still checking")
    func keepsTheLastStateWhenCancelled() async throws {
        let client = ControlledRuntimeClient()
        let readiness = RuntimeReadiness(client: client)
        await readiness.check().value
        await readiness.checkForUpdates()?.value
        let previousLocations = await client.locations
        await client.hold()
        readiness.check()
        try await client.waitForLocations(previousLocations + 1)
        #expect(readiness.installation == .checking)

        let join = try #require(readiness.cancel())

        #expect(readiness.installation == .installed("/opt/homebrew/bin/pico"))
        #expect(readiness.startup == .starts("0.1.0"))
        #expect(readiness.updates == .current("0.1.0"))
        await client.release()
        await join.value
    }

    @Test("an update check with no running version compares the installed keg")
    func comparesTheKegWhenTheCommandCannotStart() async throws {
        let client = ControlledRuntimeClient(
            location: .failure(PicoCommandError(message: "Pico couldn't find the pico command.")),
            inspection: .success(.fixedFormula(stable: "0.2.0", keg: "0.1.0"))
        )
        let readiness = RuntimeReadiness(client: client)

        await readiness.check().value
        await readiness.checkForUpdates()?.value

        #expect(readiness.updates == .available("0.1.0", "0.2.0"))
    }

    @Test("an activity is reported while a check runs and cleared when it finishes")
    func reportsActivity() async throws {
        let client = ControlledRuntimeClient()
        await client.hold()
        let readiness = RuntimeReadiness(client: client)
        let check = readiness.check()

        #expect(readiness.activity == .checking)
        #expect(readiness.isBusy)

        await client.release()
        await check.value
        #expect(readiness.activity == nil)
    }
}

extension HomebrewInspection {
    /// A formula published at `stable` with `keg` installed and linked.
    static func fixedFormula(stable: String, keg: String) -> HomebrewInspection {
        .formula(.fixture(stable: stable, installed: [keg], linked: keg))
    }
}
