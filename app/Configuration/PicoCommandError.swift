import Foundation

// A nil code identifies a local launch or protocol failure, not an error reported by pico.
struct PicoCommandError: Error, LocalizedError, Equatable, Sendable {
    let code: String?
    let message: String

    init(code: String? = nil, message: String) {
        self.code = code
        self.message = message
    }

    var errorDescription: String? { message }
}
