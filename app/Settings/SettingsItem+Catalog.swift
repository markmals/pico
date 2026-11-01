import Foundation

// Every row label in the panes comes from here, and so does every search match, so a row and
// its search result cannot disagree. Slugs are a public link contract (proposal 0005).
extension SettingsItem {
    static let runtimeStatus = SettingsItem(
        .general,
        "runtime-status",
        title: "Runtime status",
        keywords: ["readiness"]
    )
    static let engineStatus = SettingsItem(.general, "engine-status", title: "Engine status")
    static let generalAppVersion = SettingsItem(
        .general,
        "app-version",
        title: "Pico app",
        keywords: ["version"]
    )
    static let generalEngineVersion = SettingsItem(
        .general,
        "engine-version",
        title: "Engine",
        keywords: ["version"]
    )
    static let settingsFile = SettingsItem(
        .general,
        "settings-file",
        title: "Settings file",
        keywords: ["configuration", "location", "path"]
    )

    static let provider = SettingsItem(.providers, "provider", title: "Provider")
    static let providerConnectionStatus = SettingsItem(
        .providers,
        "connection-status",
        title: "Connection status"
    )
    static let account = SettingsItem(
        .providers,
        "account",
        title: "Account",
        keywords: ["sign in", "login"]
    )
    static let credentialSource = SettingsItem(
        .providers,
        "credential-source",
        title: "Credential source",
        keywords: ["API key", "OAuth", "token", "Keychain"]
    )
    static let credentialStatus = SettingsItem(
        .providers,
        "credential-status",
        title: "Credential status",
        keywords: ["sign in", "authentication"]
    )

    static let model = SettingsItem(.models, "model", title: "Model", keywords: ["default"])
    static let reasoningLevel = SettingsItem(
        .models,
        "reasoning-level",
        title: "Reasoning level",
        keywords: ["thinking", "effort"]
    )
    static let catalogSearch = SettingsItem(.models, "catalog-search", title: "Search catalog")
    static let availableModels = SettingsItem(
        .models,
        "available-models",
        title: "Available models",
        keywords: ["catalog"]
    )

    static let read = SettingsItem(.tools, "read", title: "Read", keywords: ["file"])
    static let search = SettingsItem(
        .tools,
        "search",
        title: "Search",
        keywords: ["grep", "glob", "find"]
    )
    static let edit = SettingsItem(.tools, "edit", title: "Edit", keywords: ["file"])
    static let write = SettingsItem(.tools, "write", title: "Write", keywords: ["file"])
    static let shell = SettingsItem(
        .tools,
        "shell",
        title: "Shell",
        keywords: ["bash", "terminal", "command"]
    )
    static let webSearch = SettingsItem(.tools, "web-search", title: "Web search")
    static let eval = SettingsItem(
        .tools,
        "eval",
        title: "Eval",
        keywords: ["Python", "JavaScript"]
    )
    static let builtInLSP = SettingsItem(
        .tools,
        "built-in-lsp",
        title: "Built-in LSP",
        keywords: ["language server"]
    )
    static let nativeDelegation = SettingsItem(
        .tools,
        "native-delegation",
        title: "Native delegation",
        keywords: ["subagent", "task"]
    )
    static let intellisenseLocation = SettingsItem(
        .tools,
        "intellisense-location",
        title: "intellisense location",
        keywords: ["code intelligence", "executable"]
    )

    static let helperLocation = SettingsItem(
        .sesh,
        "helper-location",
        title: "Helper location",
        keywords: ["executable"]
    )
    static let launchArguments = SettingsItem(
        .sesh,
        "launch-arguments",
        title: "Launch arguments",
        keywords: ["command"]
    )
    static let customAgent = SettingsItem(
        .sesh,
        "custom-agent",
        title: "Sesh custom agent",
        keywords: ["register", "ACP"]
    )
    static let seshConnectionStatus = SettingsItem(
        .sesh,
        "connection-status",
        title: "Connection status"
    )
    static let setupStatus = SettingsItem(.sesh, "setup-status", title: "Setup status")

    static let diagnosticsAppVersion = SettingsItem(
        .diagnostics,
        "app-version",
        title: "App version"
    )
    static let diagnosticsEngineVersion = SettingsItem(
        .diagnostics,
        "engine-version",
        title: "Engine version"
    )
    static let recentErrors = SettingsItem(
        .diagnostics,
        "recent-errors",
        title: "Recent errors",
        keywords: ["logs", "problems"]
    )
    static let diagnosticReport = SettingsItem(
        .diagnostics,
        "diagnostic-report",
        title: "Diagnostic report",
        keywords: ["export", "support"]
    )
}
