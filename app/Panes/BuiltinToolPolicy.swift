struct BuiltinToolPolicy: Sendable {
    let item: SettingsItem
    let symbol: String
    let tools: [String]

    static let included: [BuiltinToolPolicy] = [
        .init(item: .read, symbol: "doc.text", tools: ["read"]),
        .init(item: .search, symbol: "magnifyingglass", tools: ["grep", "glob"]),
        .init(item: .edit, symbol: "pencil", tools: ["edit"]),
        .init(item: .write, symbol: "square.and.pencil", tools: ["write"]),
        .init(item: .shell, symbol: "terminal", tools: ["bash"]),
        .init(item: .webSearch, symbol: "globe", tools: ["web_search"]),
        .init(item: .taskList, symbol: "checklist", tools: ["todo"]),
        .init(item: .wait, symbol: "hourglass", tools: ["wait"]),
    ]
}
