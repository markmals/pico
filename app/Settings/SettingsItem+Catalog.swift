import Foundation

// Every row label in the panes comes from here, and so does every search match, so a row and
// its search result cannot disagree. Slugs are a public link contract (proposal 0005).
extension SettingsItem {
    static let installed = SettingsItem(
        .general,
        "installed",
        title: "Installed",
        keywords: ["runtime", "readiness", "pico", "Homebrew"]
    )
    static let starts = SettingsItem(
        .general,
        "starts",
        title: "Starts",
        keywords: ["runtime", "readiness", "launch"]
    )
    static let upToDate = SettingsItem(
        .general,
        "up-to-date",
        title: "Up to date",
        keywords: ["runtime", "update", "version"]
    )
    static let generalAppVersion = SettingsItem(
        .general,
        "app-version",
        title: "Pico app",
        keywords: ["version"]
    )
    static let generalPicoVersion = SettingsItem(
        .general,
        "pico-version",
        title: "`pico`",
        keywords: ["version", "runtime"]
    )
    static let generalOMPVersion = SettingsItem(
        .general,
        "omp-version",
        title: "OMP",
        keywords: ["version", "Oh My Pi", "engine"]
    )
    static let settingsFile = SettingsItem(
        .general,
        "settings-file",
        title: "Settings file",
        keywords: ["configuration", "location", "path", "Finder"]
    )

    static let providerList = SettingsItem(
        .providers,
        "provider-list",
        title: "Providers",
        keywords: [
            "account", "sign in", "login", "credential", "API key", "OAuth", "token", "Keychain",
        ]
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
    static let diagnosticsPicoVersion = SettingsItem(
        .diagnostics,
        "pico-version",
        title: "`pico` version"
    )
    static let diagnosticsOMPVersion = SettingsItem(
        .diagnostics,
        "omp-version",
        title: "OMP version",
        keywords: ["Oh My Pi", "engine"]
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
