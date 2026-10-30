import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
    type Toolchains,
    buildReport,
    currentSwiftPolicyIssues,
    lineNumber,
    normalizeSpmIos,
    parseCommandLine,
    scanText,
    shouldSkip,
    swiftVersion,
    walkProject,
} from "./audit_project.ts";

const PACKAGE_FIXTURE = `// swift-tools-version: 6.3
import PackageDescription

let package = Package(
    name: "AuditFixture",
    platforms: [.iOS(.v16)],
    targets: [
        .target(
            name: "AuditFixture",
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .defaultIsolation(MainActor.self),
                .enableUpcomingFeature("InferSendableFromCaptures"),
                .enableExperimentalFeature("ExampleFeature"),
                .strictMemorySafety(),
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
`;

const XCCONFIG_FIXTURE = `IPHONEOS_DEPLOYMENT_TARGET = 16.0
SWIFT_VERSION = 6.0
SWIFT_APPROACHABLE_CONCURRENCY = YES
SWIFT_STRICT_MEMORY_SAFETY = YES
BUILD_LIBRARY_FOR_DISTRIBUTION = YES
SDKROOT = iphoneos
`;

function pairs(findings: { category: string; value: string }[]): string[] {
    return findings.map(item => `${item.category}=${item.value}`);
}

function emptyToolchains(): Toolchains {
    return { sdks: null, swift: null, xcode: null, xcode_swift: null };
}

test("Package.swift declarations are inventoried", () => {
    const observed = pairs(scanText(PACKAGE_FIXTURE, "Package.swift", "Package.swift"));
    for (const expected of [
        "SwiftPM tools version=6.3",
        "SwiftPM iOS deployment target=16",
        "SwiftPM package language modes=.v6",
        "SwiftPM target language mode=.v6",
        "SwiftPM target default isolation=MainActor.self",
        "SwiftPM upcoming feature=InferSendableFromCaptures",
        "SwiftPM experimental feature=ExampleFeature",
        "SwiftPM strict memory safety=enabled",
    ]) {
        assert.ok(
            observed.includes(expected),
            `${expected} missing from ${JSON.stringify(observed)}`,
        );
    }
});

test("xcconfig build settings are inventoried with line numbers", () => {
    const findings = scanText(XCCONFIG_FIXTURE, "Compatibility.xcconfig", "Compatibility.xcconfig");
    assert.deepEqual(pairs(findings), [
        "IPHONEOS_DEPLOYMENT_TARGET=16.0",
        "SWIFT_VERSION=6.0",
        "SWIFT_APPROACHABLE_CONCURRENCY=YES",
        "SWIFT_STRICT_MEMORY_SAFETY=YES",
        "BUILD_LIBRARY_FOR_DISTRIBUTION=YES",
        "SDKROOT=iphoneos",
    ]);
    assert.deepEqual(
        findings.map(item => item.line),
        [1, 2, 3, 4, 5, 6],
    );
});

test("upcoming and experimental feature settings are matched by prefix", () => {
    const text =
        'SWIFT_UPCOMING_FEATURE_EXISTENTIAL_ANY = YES;\nSWIFT_EXPERIMENTAL_FEATURE_SOMETHING = "NO";\n';
    assert.deepEqual(pairs(scanText(text, "Project.pbxproj", "Project.pbxproj")), [
        "SWIFT_UPCOMING_FEATURE_EXISTENTIAL_ANY=YES",
        "SWIFT_EXPERIMENTAL_FEATURE_SOMETHING=NO",
    ]);
});

test("toolchain hint files are recorded as a single compact finding", () => {
    const findings = scanText("\n6.3.0\n\n", ".swift-version", ".swift-version");
    assert.deepEqual(findings, [
        {
            category: "Toolchain hint (.swift-version)",
            file: ".swift-version",
            line: 1,
            value: "6.3.0",
        },
    ]);
    assert.deepEqual(scanText("\n\n", ".tool-versions", ".tool-versions"), []);
});

test("SwiftPM iOS versions normalize to dotted form", () => {
    assert.equal(normalizeSpmIos({ symbol: "16_4" }), "16.4");
    assert.equal(normalizeSpmIos({ string: "16.0" }), "16.0");
    assert.equal(
        pairs(
            scanText(
                'let package = Package(platforms: [.iOS("17.2")])\n',
                "Package.swift",
                "Package.swift",
            ),
        )[0],
        "SwiftPM iOS deployment target=17.2",
    );
});

test("line numbers count newlines before the offset", () => {
    const text = "a\nb\nc";
    assert.equal(lineNumber(text, 0), 1);
    assert.equal(lineNumber(text, 2), 2);
    assert.equal(lineNumber(text, 4), 3);
});

test("ignored directories are skipped at any depth", () => {
    assert.equal(shouldSkip("Sources/App/Package.swift"), false);
    assert.equal(shouldSkip(path.join(".build", "checkouts", "Package.swift")), true);
    assert.equal(shouldSkip(path.join("App", "Pods", "Pod.xcconfig")), true);
    assert.equal(shouldSkip(""), true);
});

test("the project walk finds containers and candidate files", () => {
    const root = mkdtempSync(path.join(tmpdir(), "audit-walk-"));
    try {
        mkdirSync(path.join(root, "App.xcodeproj"), { recursive: true });
        writeFileSync(
            path.join(root, "App.xcodeproj", "project.pbxproj"),
            "SWIFT_VERSION = 6.0;\n",
        );
        mkdirSync(path.join(root, "App.xcworkspace"), { recursive: true });
        mkdirSync(path.join(root, "Package", "Sources"), { recursive: true });
        writeFileSync(path.join(root, "Package", "Package.swift"), PACKAGE_FIXTURE);
        writeFileSync(path.join(root, ".swift-version"), "6.3\n");
        mkdirSync(path.join(root, ".build", "checkouts"), { recursive: true });
        writeFileSync(path.join(root, ".build", "checkouts", "Package.swift"), PACKAGE_FIXTURE);

        const walked = walkProject(root);
        assert.deepEqual(walked.projects, ["App.xcodeproj"]);
        assert.deepEqual(walked.workspaces, ["App.xcworkspace"]);
        assert.deepEqual(walked.packages, [path.join("Package", "Package.swift")]);
        assert.deepEqual(
            walked.files.map(file => path.relative(root, file)).sort(),
            [
                ".swift-version",
                path.join("App.xcodeproj", "project.pbxproj"),
                path.join("Package", "Package.swift"),
            ].sort(),
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("only a compiler below the fixture floor is reported", () => {
    assert.deepEqual(swiftVersion("Apple Swift version 6.4 (swiftlang-6.4.0.34.1)"), [6, 4]);
    assert.equal(swiftVersion("no version"), null);
    assert.deepEqual(
        currentSwiftPolicyIssues({ ...emptyToolchains(), swift: "Apple Swift version 6.4" }),
        [],
    );
    assert.deepEqual(
        currentSwiftPolicyIssues({ ...emptyToolchains(), swift: "Apple Swift version 6.3" }),
        [],
    );
    assert.deepEqual(currentSwiftPolicyIssues(emptyToolchains()), []);
    assert.deepEqual(
        currentSwiftPolicyIssues({
            ...emptyToolchains(),
            swift: "Apple Swift version 6.2 (extra)\nTarget: arm64",
        }),
        [
            "selected compiler is below the bundled fixtures' Swift 6.3 minimum: Apple Swift version 6.2 (extra)",
        ],
    );
    // The Xcode-selected compiler wins over a loose `swift` on PATH.
    assert.deepEqual(
        currentSwiftPolicyIssues({
            ...emptyToolchains(),
            swift: "Apple Swift version 6.4",
            xcode_swift: "Apple Swift version 5.9",
        }),
        [
            "selected compiler is below the bundled fixtures' Swift 6.3 minimum: Apple Swift version 5.9",
        ],
    );
});

test("the report serializes with sorted keys and skipped toolchains", () => {
    const root = mkdtempSync(path.join(tmpdir(), "audit-report-"));
    try {
        writeFileSync(path.join(root, "Package.swift"), PACKAGE_FIXTURE);
        writeFileSync(path.join(root, "Compatibility.xcconfig"), XCCONFIG_FIXTURE);
        const report = buildReport(root, { includeToolchains: false });
        assert.equal(report.toolchains_checked, false);
        assert.equal(report.files_scanned, 2);
        assert.deepEqual(report.current_swift_policy.issues, []);
        assert.deepEqual(Object.keys(report), [...Object.keys(report)].sort());
        assert.deepEqual(
            Object.keys(report.containers),
            [...Object.keys(report.containers)].sort(),
        );
        assert.deepEqual(
            Object.keys(report.toolchains),
            [...Object.keys(report.toolchains)].sort(),
        );
        assert.deepEqual(
            Object.keys(report.findings[0]),
            [...Object.keys(report.findings[0])].sort(),
        );
        const sorted = [...report.findings].sort(
            (left, right) =>
                left.category.localeCompare(right.category) ||
                left.value.localeCompare(right.value),
        );
        assert.deepEqual(
            report.findings.map(item => item.category),
            sorted.map(item => item.category),
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("the command line keeps the documented defaults", () => {
    assert.deepEqual(parseCommandLine([]), { root: ".", json: false, skipToolchains: false });
    assert.deepEqual(parseCommandLine(["/tmp/project", "--json", "--skip-toolchains"]), {
        root: "/tmp/project",
        json: true,
        skipToolchains: true,
    });
    assert.equal(parseCommandLine(["--help"]), "help");
});
