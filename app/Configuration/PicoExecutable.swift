import Foundation

// Finder launches do not inherit a shell's PATH; only the explicit override and Homebrew paths apply.
enum PicoExecutable {
    /// Where Homebrew links `pico`, on Apple silicon and on Intel.
    static let homebrewCandidates = ["/opt/homebrew/bin/pico", "/usr/local/bin/pico"]

    static func resolve(
        override: String?,
        candidates: [String] = homebrewCandidates
    ) throws -> URL {
        if let override {
            guard canRun(override) else {
                throw PicoCommandError(message: .notAnExecutable(override))
            }
            return URL(fileURLWithPath: override)
        }
        guard let installed = candidates.first(where: canRun) else {
            throw PicoCommandError(message: .noExecutableInstalled(candidates))
        }
        return URL(fileURLWithPath: installed)
    }

    private static func canRun(_ path: String) -> Bool {
        let file = URL(fileURLWithPath: path).resolvingSymlinksInPath()
        guard (try? file.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else {
            return false
        }
        return FileManager.default.isExecutableFile(atPath: path)
    }
}

extension String {
    fileprivate static func noExecutableInstalled(_ candidates: [String]) -> String {
        let locations = candidates.formatted(.list(type: .or))
        return String(
            localized:
                "Pico couldn't find the pico command in \(locations). Install it with Homebrew, or launch Pico with -PicoExecutable and the path to it."
        )
    }

    fileprivate static func notAnExecutable(_ path: String) -> String {
        String(
            localized:
                "Pico couldn't use \(path) as the pico command: there is no executable file there."
        )
    }
}
