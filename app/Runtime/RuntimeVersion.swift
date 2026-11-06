import Foundation

/// A version two commands can be compared by: the numbers, an optional prerelease that comes
/// before the release it leads to, and Homebrew's `_n` package revision of the same version.
/// Text that is not a version, such as `HEAD`, has no order and is refused.
struct RuntimeVersion: Comparable, Sendable {
    private let numbers: [Int]
    private let prerelease: [String]?
    private let revision: Int

    init?(_ text: String) {
        var body = text.trimmingCharacters(in: .whitespaces)
        guard !body.isEmpty else { return nil }
        var revision = 0
        if let separator = body.lastIndex(of: "_") {
            guard let value = Int(body[body.index(after: separator)...]), value >= 0 else {
                return nil
            }
            revision = value
            body = String(body[..<separator])
        }
        if let separator = body.firstIndex(of: "+") {
            guard Self.identifiers(body[body.index(after: separator)...]) != nil else { return nil }
            body = String(body[..<separator])
        }
        var prerelease: [String]?
        if let separator = body.firstIndex(of: "-") {
            guard let identifiers = Self.identifiers(body[body.index(after: separator)...]),
                identifiers.allSatisfy({
                    !$0.utf8.allSatisfy(Self.isDigit) || $0.count == 1 || $0.first != "0"
                })
            else { return nil }
            prerelease = identifiers.map(String.init)
            body = String(body[..<separator])
        }
        var numbers: [Int] = []
        for part in body.split(separator: ".", omittingEmptySubsequences: false) {
            guard part.utf8.allSatisfy(Self.isDigit), let number = Int(part) else { return nil }
            numbers.append(number)
        }
        guard !numbers.isEmpty else { return nil }
        self.numbers = numbers
        self.prerelease = prerelease
        self.revision = revision
    }

    static func < (lhs: Self, rhs: Self) -> Bool {
        for index in 0..<max(lhs.numbers.count, rhs.numbers.count) {
            let left = index < lhs.numbers.count ? lhs.numbers[index] : 0
            let right = index < rhs.numbers.count ? rhs.numbers[index] : 0
            guard left == right else { return left < right }
        }
        switch (lhs.prerelease, rhs.prerelease) {
        case (let left?, let right?) where left != right:
            return precedes(left, right)
        case (.some, nil): return true
        case (nil, .some): return false
        default: return lhs.revision < rhs.revision
        }
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        !(lhs < rhs) && !(rhs < lhs)
    }

    private static func identifiers(_ text: Substring) -> [Substring]? {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard
            parts.allSatisfy({ part in
                !part.isEmpty
                    && part.utf8.allSatisfy {
                        isDigit($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45
                    }
            })
        else { return nil }
        return parts
    }

    private static func isDigit(_ byte: UInt8) -> Bool {
        (48...57).contains(byte)
    }

    private static func precedes(_ lhs: [String], _ rhs: [String]) -> Bool {
        for (left, right) in zip(lhs, rhs) where left != right {
            let leftIsNumber = left.utf8.allSatisfy(isDigit)
            let rightIsNumber = right.utf8.allSatisfy(isDigit)
            if leftIsNumber != rightIsNumber { return leftIsNumber }
            if leftIsNumber, left.count != right.count { return left.count < right.count }
            return left < right
        }
        return lhs.count < rhs.count
    }
}
