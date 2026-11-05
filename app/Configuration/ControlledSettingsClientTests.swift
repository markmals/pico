import Foundation

@testable import Pico

actor ControlledSettingsClient: PicoSettingsServing {
    private(set) var loadCount = 0
    private(set) var writeCount = 0
    private(set) var saved: PicoModelSettings

    private let defaults: [String: String]
    private let responses = AsyncStream<Result<Void, PicoCommandError>>.makeStream()

    init() throws {
        let entries = try JSONDecoder().decode([CatalogFixture].self, from: Data(Self.catalog.utf8))
        defaults = Dictionary(
            uniqueKeysWithValues: entries.map { ($0.model.value, $0.defaultThinking) }
        )
        saved = PicoModelSettings(
            settingsFile: "/tmp/pico-tests/settings.json",
            revision: "r0",
            item: .init(defaultModel: "provider/first", defaultThinking: "high"),
            effective: .init(
                defaultModel: "provider/first",
                defaultThinking: "high",
                available: true
            ),
            models: entries.map(\.model)
        )
    }

    func changeExternally() {
        saved = saved.applying(
            PicoSettingsReceipt(
                settingsFile: saved.settingsFile,
                after: .init(
                    revision: "external",
                    item: .init(defaultModel: "provider/third", defaultThinking: "xhigh")
                )
            )
        )
    }

    func finish() {
        responses.continuation.finish()
    }

    func load() async throws -> PicoSettingsLoad {
        loadCount += 1
        return .ready(saved)
    }

    func release(_ failure: PicoCommandError? = nil) {
        responses.continuation.yield(failure.map { .failure($0) } ?? .success(()))
    }

    func update(_ change: PicoSettingsChange, revision: String) async throws -> PicoSettingsReceipt
    {
        writeCount += 1
        for await response in responses.stream {
            try response.get()
            guard revision == saved.revision else {
                throw PicoCommandError(code: "CONFLICT", message: "Changed outside this window")
            }
            let arguments = change.arguments
            let modelValue = option("--default-model", in: arguments) ?? saved.item.defaultModel
            guard let model = saved.models.first(where: { $0.value == modelValue }) else {
                throw PicoCommandError(code: "NOT_FOUND", message: "Unknown model")
            }
            let kept = saved.item.defaultThinking.flatMap { level in
                model.thinking.contains { $0.value == level } ? level : nil
            }
            let thinking =
                option("--default-thinking", in: arguments) ?? kept ?? defaults[model.value]
            guard model.thinking.contains(where: { $0.value == thinking }) else {
                throw PicoCommandError(
                    code: "INVALID_ARGUMENT",
                    message: "Unsupported reasoning level"
                )
            }
            let receipt = PicoSettingsReceipt(
                settingsFile: saved.settingsFile,
                after: .init(
                    revision: "r\(writeCount)",
                    item: .init(defaultModel: model.value, defaultThinking: thinking)
                )
            )
            saved = saved.applying(receipt)
            return receipt
        }
        throw CancellationError()
    }

    func waitForLoads(_ count: Int) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while loadCount < count {
            guard ContinuousClock.now < deadline else {
                throw PicoCommandError(message: "Load did not start")
            }
            try await Task.sleep(for: .milliseconds(5))
        }
    }

    func waitForWrites(_ count: Int) async throws {
        let deadline = ContinuousClock.now + .seconds(5)
        while writeCount < count {
            guard ContinuousClock.now < deadline else {
                throw PicoCommandError(message: "Save did not start")
            }
            try await Task.sleep(for: .milliseconds(5))
        }
    }

    private func option(_ name: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: name) else { return nil }
        return arguments[index + 1]
    }

    private static let catalog = #"""
        [
            {"value":"provider/first","name":"First","provider":"provider","thinking":[{"value":"off","name":"Off"},{"value":"low","name":"low"},{"value":"high","name":"high"}],"defaultThinking":"high"},
            {"value":"provider/second","name":"Second","provider":"provider","thinking":[{"value":"off","name":"Off"},{"value":"low","name":"low"}],"defaultThinking":"low"},
            {"value":"provider/third","name":"Third","provider":"provider","thinking":[{"value":"off","name":"Off"},{"value":"xhigh","name":"xhigh"}],"defaultThinking":"xhigh"}
        ]
        """#
}

extension ControlledSettingsClient {
    private struct CatalogFixture: Decodable {
        let model: PicoModel
        let defaultThinking: String

        private enum CodingKeys: String, CodingKey {
            case defaultThinking
        }

        init(from decoder: any Decoder) throws {
            model = try PicoModel(from: decoder)
            defaultThinking = try decoder.container(keyedBy: CodingKeys.self).decode(
                String.self,
                forKey: .defaultThinking
            )
        }
    }
}
