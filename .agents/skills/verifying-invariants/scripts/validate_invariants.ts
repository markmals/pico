#!/usr/bin/env bun

// Validate an invariant manifest without running any declared checks.
//
// This is intentionally a schema and local-reference validator.  Commands are
// treated as opaque text so validating an untrusted manifest cannot execute it.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join as joinPath, resolve as resolvePath, sep as pathSeparator } from "node:path";

export type Diagnostic = {
    code: string;
    message: string;
    path: string;
};

export type JsonObject = Record<string, unknown>;

export let PROG = "validate_invariants.ts";

export let KINDS = new Set(["structural", "refined-value", "transition", "external"]);
export let METHODS = new Set([
    "static-analysis",
    "compiler-rejection",
    "boundary-test",
    "property-test",
    "transition-test",
    "integration-test",
    "artifact-inspection",
    "manual-review",
    "bounded-exploration",
    "formal-proof",
]);
export let ROOT_FIELDS = new Set(["schema_version", "invariants"]);
export let INVARIANT_FIELDS = new Set([
    "id",
    "statement",
    "kind",
    "scope",
    "authority",
    "boundaries",
    "assumptions",
    "checks",
]);
export let SCOPE_FIELDS = new Set(["references"]);
export let AUTHORITY_FIELDS = new Set(["description", "references"]);
export let REFERENCE_FIELDS = new Set(["path", "symbol"]);
export let CHECK_FIELDS = new Set([
    "id",
    "method",
    "command",
    "artifact",
    "implementation",
    "limitations",
    "bounds",
]);
export let BOUNDARY_FIELDS = new Set(["surfaces", "exclusions"]);
export let BOUNDARY_SURFACES = new Set([
    "construction",
    "decoding",
    "mutation",
    "transition",
    "external",
]);
export let BOUNDS_FIELDS = new Set(["domain", "resource_limits"]);
export let RESOURCE_LIMIT_FIELDS = new Set(["max_states", "max_depth", "max_seconds"]);

// Ordering is by code point so diagnostics stay identical across locales.
export function compareStrings(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

export function sortedValues(values: Set<string> | string[]): string[] {
    return [...values].sort(compareStrings);
}

export class DuplicateKeyError extends Error {
    key: string;

    constructor(key: string) {
        super(key);
        this.key = key;
    }
}

export class JsonSyntaxError extends Error {
    msg: string;

    constructor(msg: string) {
        super(msg);
        this.msg = msg;
    }
}

export class InvalidEncodingError extends Error {}

// A manifest number must stay distinguishable as integer or float: schema_version
// and the resource limits accept 1 but reject 1.0, which JSON.parse cannot express.
export class JsonFloat {
    value: number;

    constructor(value: number) {
        this.value = value;
    }
}

export function rejectDuplicateKeys(pairs: [string, unknown][]): JsonObject {
    // Null prototype keeps manifest keys such as "__proto__" as ordinary data.
    let result: JsonObject = Object.create(null);
    for (let [key, value] of pairs) {
        if (Object.hasOwn(result, key)) {
            throw new DuplicateKeyError(key);
        }
        result[key] = value;
    }
    return result;
}

let JSON_WHITESPACE = " \t\n\r";
let JSON_ESCAPES: Record<string, string> = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
};
let JSON_NUMBER = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/y;

type Scanner = {
    text: string;
    pos: number;
};

function skipJsonWhitespace(scanner: Scanner): void {
    while (
        scanner.pos < scanner.text.length &&
        JSON_WHITESPACE.includes(scanner.text[scanner.pos])
    ) {
        scanner.pos += 1;
    }
}

function scanJsonString(scanner: Scanner): string {
    let result = "";
    while (true) {
        if (scanner.pos >= scanner.text.length) {
            throw new JsonSyntaxError("Unterminated string starting at");
        }
        let char = scanner.text[scanner.pos];
        if (char === '"') {
            scanner.pos += 1;
            return result;
        }
        if (char === "\\") {
            if (scanner.pos + 1 >= scanner.text.length) {
                throw new JsonSyntaxError("Unterminated string starting at");
            }
            let escape = scanner.text[scanner.pos + 1];
            if (escape === "u") {
                let digits = scanner.text.slice(scanner.pos + 2, scanner.pos + 6);
                if (!/^[0-9A-Fa-f]{4}$/.test(digits)) {
                    throw new JsonSyntaxError("Invalid \\uXXXX escape");
                }
                result += String.fromCharCode(Number.parseInt(digits, 16));
                scanner.pos += 6;
                continue;
            }
            let decoded = Object.hasOwn(JSON_ESCAPES, escape) ? JSON_ESCAPES[escape] : undefined;
            if (decoded === undefined) {
                throw new JsonSyntaxError("Invalid \\escape");
            }
            result += decoded;
            scanner.pos += 2;
            continue;
        }
        if (char.charCodeAt(0) < 0x20) {
            throw new JsonSyntaxError("Invalid control character at");
        }
        result += char;
        scanner.pos += 1;
    }
}

function scanJsonObject(scanner: Scanner): JsonObject {
    let pairs: [string, unknown][] = [];
    skipJsonWhitespace(scanner);
    if (scanner.text[scanner.pos] === "}") {
        scanner.pos += 1;
        return rejectDuplicateKeys(pairs);
    }
    if (scanner.text[scanner.pos] !== '"') {
        throw new JsonSyntaxError("Expecting property name enclosed in double quotes");
    }
    while (true) {
        scanner.pos += 1;
        let key = scanJsonString(scanner);
        skipJsonWhitespace(scanner);
        if (scanner.text[scanner.pos] !== ":") {
            throw new JsonSyntaxError("Expecting ':' delimiter");
        }
        scanner.pos += 1;
        skipJsonWhitespace(scanner);
        pairs.push([key, scanJsonValue(scanner)]);
        skipJsonWhitespace(scanner);
        let terminator = scanner.text[scanner.pos];
        if (terminator === "}") {
            scanner.pos += 1;
            return rejectDuplicateKeys(pairs);
        }
        if (terminator !== ",") {
            throw new JsonSyntaxError("Expecting ',' delimiter");
        }
        scanner.pos += 1;
        skipJsonWhitespace(scanner);
        if (scanner.text[scanner.pos] === "}") {
            throw new JsonSyntaxError("Illegal trailing comma before end of object");
        }
        if (scanner.text[scanner.pos] !== '"') {
            throw new JsonSyntaxError("Expecting property name enclosed in double quotes");
        }
    }
}

function scanJsonArray(scanner: Scanner): unknown[] {
    let values: unknown[] = [];
    skipJsonWhitespace(scanner);
    if (scanner.text[scanner.pos] === "]") {
        scanner.pos += 1;
        return values;
    }
    while (true) {
        values.push(scanJsonValue(scanner));
        skipJsonWhitespace(scanner);
        let terminator = scanner.text[scanner.pos];
        if (terminator === "]") {
            scanner.pos += 1;
            return values;
        }
        if (terminator !== ",") {
            throw new JsonSyntaxError("Expecting ',' delimiter");
        }
        scanner.pos += 1;
        skipJsonWhitespace(scanner);
        if (scanner.text[scanner.pos] === "]") {
            throw new JsonSyntaxError("Illegal trailing comma before end of array");
        }
    }
}

function scanJsonValue(scanner: Scanner): unknown {
    let text = scanner.text;
    let char = text[scanner.pos];
    if (char === '"') {
        scanner.pos += 1;
        return scanJsonString(scanner);
    }
    if (char === "{") {
        scanner.pos += 1;
        return scanJsonObject(scanner);
    }
    if (char === "[") {
        scanner.pos += 1;
        return scanJsonArray(scanner);
    }
    if (text.startsWith("null", scanner.pos)) {
        scanner.pos += 4;
        return null;
    }
    if (text.startsWith("true", scanner.pos)) {
        scanner.pos += 4;
        return true;
    }
    if (text.startsWith("false", scanner.pos)) {
        scanner.pos += 5;
        return false;
    }
    JSON_NUMBER.lastIndex = scanner.pos;
    let match = JSON_NUMBER.exec(text);
    if (match !== null) {
        scanner.pos += match[0].length;
        if (match[1] !== undefined || match[2] !== undefined) {
            return new JsonFloat(Number.parseFloat(match[0]));
        }
        return Number.parseInt(match[0], 10);
    }
    if (text.startsWith("NaN", scanner.pos)) {
        scanner.pos += 3;
        return new JsonFloat(Number.NaN);
    }
    if (text.startsWith("Infinity", scanner.pos)) {
        scanner.pos += 8;
        return new JsonFloat(Number.POSITIVE_INFINITY);
    }
    if (text.startsWith("-Infinity", scanner.pos)) {
        scanner.pos += 9;
        return new JsonFloat(Number.NEGATIVE_INFINITY);
    }
    throw new JsonSyntaxError("Expecting value");
}

export function parseJson(text: string): unknown {
    if (text.startsWith("\ufeff")) {
        throw new JsonSyntaxError("Unexpected UTF-8 BOM (decode using utf-8-sig)");
    }
    let scanner: Scanner = { text, pos: 0 };
    skipJsonWhitespace(scanner);
    let value = scanJsonValue(scanner);
    skipJsonWhitespace(scanner);
    if (scanner.pos !== text.length) {
        throw new JsonSyntaxError("Extra data");
    }
    return value;
}

export function encodeJsonString(value: string): string {
    let result = '"';
    for (let index = 0; index < value.length; index += 1) {
        let char = value[index];
        let code = value.charCodeAt(index);
        if (char === '"') {
            result += '\\"';
        } else if (char === "\\") {
            result += "\\\\";
        } else if (code === 0x08) {
            result += "\\b";
        } else if (code === 0x0c) {
            result += "\\f";
        } else if (code === 0x0a) {
            result += "\\n";
        } else if (code === 0x0d) {
            result += "\\r";
        } else if (code === 0x09) {
            result += "\\t";
        } else if (code >= 0x20 && code <= 0x7e) {
            result += char;
        } else {
            result += `\\u${code.toString(16).padStart(4, "0")}`;
        }
    }
    return `${result}"`;
}

export function encodeJsonReport(diagnostics: Diagnostic[], valid: boolean): string {
    let items = diagnostics.map(item =>
        [
            `{"code":${encodeJsonString(item.code)}`,
            `"message":${encodeJsonString(item.message)}`,
            `"path":${encodeJsonString(item.path)}}`,
        ].join(","),
    );
    return `{"diagnostics":[${items.join(",")}],"valid":${valid ? "true" : "false"}}`;
}

// Mirrors str(PurePosixPath(value)): empty and "." components collapse, a
// trailing separator drops, and only a leading "//" survives as written.
export function posixPathDisplay(value: string): string {
    let parts = posixPathParts(value);
    if (!value.startsWith("/")) {
        return parts.length === 0 ? "." : parts.join("/");
    }
    let prefix = value.startsWith("//") && !value.startsWith("///") ? "//" : "/";
    return prefix + parts.join("/");
}

export function posixPathParts(value: string): string[] {
    return value.split("/").filter(part => part !== "" && part !== ".");
}

function isJsonObject(value: unknown): value is JsonObject {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof JsonFloat)
    );
}

function isContainedBy(target: string, root: string): boolean {
    if (target === root) {
        return true;
    }
    let prefix = root.endsWith(pathSeparator) ? root : root + pathSeparator;
    return target.startsWith(prefix);
}

// Path.resolve() is non-strict in Python, so a missing path still normalizes.
function resolveSymlinks(value: string): string {
    try {
        return realpathSync(value);
    } catch {
        return resolvePath(value);
    }
}

export class Validator {
    root: string;
    diagnostics: Diagnostic[];

    constructor(root: string) {
        this.root = resolveSymlinks(root);
        this.diagnostics = [];
    }

    error(path: string, code: string, message: string): void {
        this.diagnostics.push({ code, message, path });
    }

    object(value: unknown, path: string): JsonObject | null {
        if (!isJsonObject(value)) {
            this.error(path, "schema.type", "must be an object");
            return null;
        }
        return value;
    }

    array(value: unknown, path: string, allowEmpty = false): unknown[] | null {
        if (!Array.isArray(value)) {
            this.error(path, "schema.type", "must be an array");
            return null;
        }
        if (!allowEmpty && value.length === 0) {
            this.error(path, "schema.empty", "must not be empty");
        }
        return value;
    }

    string(value: unknown, path: string, allowEmpty = false): string | null {
        if (typeof value !== "string") {
            this.error(path, "schema.type", "must be a string");
            return null;
        }
        if (!allowEmpty && value.trim() === "") {
            this.error(path, "schema.empty", "must not be empty");
        }
        return value;
    }

    fields(obj: JsonObject, allowed: Set<string>, required: Set<string>, path: string): void {
        for (let key of sortedValues(Object.keys(obj).filter(key => !allowed.has(key)))) {
            this.error(`${path}/${key}`, "schema.unknown-field", "is not allowed");
        }
        for (let key of sortedValues([...required].filter(key => !Object.hasOwn(obj, key)))) {
            this.error(path, "schema.missing-field", `missing required field '${key}'`);
        }
    }

    reference(value: unknown, path: string): void {
        let obj = this.object(value, path);
        if (obj === null) {
            return;
        }
        this.fields(obj, REFERENCE_FIELDS, new Set(["path"]), path);
        let rawPath = this.string(obj["path"], `${path}/path`);
        if (Object.hasOwn(obj, "symbol")) {
            this.string(obj["symbol"], `${path}/symbol`);
        }
        if (rawPath === null || rawPath.trim() === "") {
            return;
        }
        let parts = posixPathParts(rawPath);
        if (rawPath.startsWith("/") || parts.includes("..")) {
            this.error(
                `${path}/path`,
                "reference.path",
                "must be a relative path contained by --root",
            );
            return;
        }
        let target = joinPath(this.root, ...parts);
        if (!existsSync(target)) {
            this.error(
                `${path}/path`,
                "reference.missing",
                `does not exist under --root: ${rawPath}`,
            );
            return;
        }
        if (!isContainedBy(resolveSymlinks(target), this.root)) {
            this.error(`${path}/path`, "reference.escape", "resolves outside --root");
        }
    }

    references(value: unknown, path: string, allowEmpty = false): void {
        let values = this.array(value, path, allowEmpty);
        if (values !== null) {
            values.forEach((reference, index) => this.reference(reference, `${path}/${index}`));
        }
    }

    textList(value: unknown, path: string, allowEmpty: boolean): void {
        let values = this.array(value, path, allowEmpty);
        if (values !== null) {
            values.forEach((item, index) => this.string(item, `${path}/${index}`));
        }
    }

    check(value: unknown, path: string): string | null {
        let obj = this.object(value, path);
        if (obj === null) {
            return null;
        }
        this.fields(obj, CHECK_FIELDS, new Set(["id", "method", "limitations"]), path);
        let checkId = this.string(obj["id"], `${path}/id`);
        let method = this.string(obj["method"], `${path}/method`);
        if (method !== null && !METHODS.has(method)) {
            this.error(
                `${path}/method`,
                "schema.value",
                `must be one of: ${sortedValues(METHODS).join(", ")}`,
            );
        }
        let hasCommand = Object.hasOwn(obj, "command");
        let hasArtifact = Object.hasOwn(obj, "artifact");
        if (!hasCommand && !hasArtifact) {
            this.error(path, "check.evidence", "requires command and/or artifact");
        }
        if (hasCommand) {
            this.string(obj["command"], `${path}/command`);
        }
        if (hasArtifact) {
            this.reference(obj["artifact"], `${path}/artifact`);
        }
        if (Object.hasOwn(obj, "implementation")) {
            this.reference(obj["implementation"], `${path}/implementation`);
        }
        this.textList(obj["limitations"], `${path}/limitations`, true);
        if (method === "bounded-exploration") {
            let bounds = this.object(obj["bounds"], `${path}/bounds`);
            if (bounds !== null) {
                this.fields(bounds, BOUNDS_FIELDS, new Set(["domain"]), `${path}/bounds`);
                this.string(bounds["domain"], `${path}/bounds/domain`);
                if (Object.hasOwn(bounds, "resource_limits")) {
                    let limits = this.object(
                        bounds["resource_limits"],
                        `${path}/bounds/resource_limits`,
                    );
                    if (limits !== null) {
                        this.fields(
                            limits,
                            RESOURCE_LIMIT_FIELDS,
                            new Set(),
                            `${path}/bounds/resource_limits`,
                        );
                        if (Object.keys(limits).length === 0) {
                            this.error(
                                `${path}/bounds/resource_limits`,
                                "schema.empty",
                                "must not be empty when present",
                            );
                        }
                        for (let name of sortedValues(Object.keys(limits))) {
                            let item = limits[name];
                            if (typeof item !== "number" || item <= 0) {
                                this.error(
                                    `${path}/bounds/resource_limits/${name}`,
                                    "bounds.value",
                                    "must be a positive integer",
                                );
                            }
                        }
                    }
                }
            }
        } else if (Object.hasOwn(obj, "bounds")) {
            this.error(
                `${path}/bounds`,
                "schema.unexpected-field",
                "is only allowed for bounded-exploration",
            );
        }
        if (method === "formal-proof" && !Object.hasOwn(obj, "implementation")) {
            this.error(path, "formal-proof.implementation", "requires an implementation reference");
        }
        return checkId;
    }

    invariant(value: unknown, path: string): string | null {
        let obj = this.object(value, path);
        if (obj === null) {
            return null;
        }
        this.fields(obj, INVARIANT_FIELDS, INVARIANT_FIELDS, path);
        let invariantId = this.string(obj["id"], `${path}/id`);
        this.string(obj["statement"], `${path}/statement`);
        let kind = this.string(obj["kind"], `${path}/kind`);
        if (kind !== null && !KINDS.has(kind)) {
            this.error(
                `${path}/kind`,
                "schema.value",
                `must be one of: ${sortedValues(KINDS).join(", ")}`,
            );
        }
        let scope = this.object(obj["scope"], `${path}/scope`);
        if (scope !== null) {
            this.fields(scope, SCOPE_FIELDS, SCOPE_FIELDS, `${path}/scope`);
            this.references(scope["references"], `${path}/scope/references`);
        }
        let authority = this.object(obj["authority"], `${path}/authority`);
        if (authority !== null) {
            this.fields(authority, AUTHORITY_FIELDS, AUTHORITY_FIELDS, `${path}/authority`);
            this.string(authority["description"], `${path}/authority/description`);
            this.references(authority["references"], `${path}/authority/references`);
        }
        let boundaries = this.object(obj["boundaries"], `${path}/boundaries`);
        if (boundaries !== null) {
            this.fields(boundaries, BOUNDARY_FIELDS, BOUNDARY_FIELDS, `${path}/boundaries`);
            let surfaces = this.array(boundaries["surfaces"], `${path}/boundaries/surfaces`);
            if (surfaces !== null) {
                surfaces.forEach((surface, index) => {
                    let surfacePath = `${path}/boundaries/surfaces/${index}`;
                    let text = this.string(surface, surfacePath);
                    if (text !== null && !BOUNDARY_SURFACES.has(text)) {
                        this.error(
                            surfacePath,
                            "schema.value",
                            `must be one of: ${sortedValues(BOUNDARY_SURFACES).join(", ")}`,
                        );
                    }
                });
            }
            this.textList(boundaries["exclusions"], `${path}/boundaries/exclusions`, true);
        }
        let assumptions = obj["assumptions"];
        this.textList(assumptions, `${path}/assumptions`, true);
        let checks = this.array(obj["checks"], `${path}/checks`);
        let checkIds = new Set<string>();
        let formalProof = false;
        if (checks !== null) {
            checks.forEach((item, index) => {
                let itemPath = `${path}/checks/${index}`;
                let checkId = this.check(item, itemPath);
                if (checkId) {
                    if (checkIds.has(checkId)) {
                        this.error(
                            `${itemPath}/id`,
                            "identity.duplicate-check",
                            `duplicate check id '${checkId}'`,
                        );
                    }
                    checkIds.add(checkId);
                }
                if (isJsonObject(item) && item["method"] === "formal-proof") {
                    formalProof = true;
                }
            });
        }
        if (formalProof && Array.isArray(assumptions) && assumptions.length === 0) {
            this.error(
                `${path}/assumptions`,
                "formal-proof.assumptions",
                "must be non-empty when a formal-proof check is declared",
            );
        }
        return invariantId;
    }

    validate(document: unknown): Diagnostic[] {
        let root = this.object(document, "");
        if (root === null) {
            return this.sortedDiagnostics();
        }
        this.fields(root, ROOT_FIELDS, ROOT_FIELDS, "");
        if (typeof root["schema_version"] !== "number" || root["schema_version"] !== 1) {
            this.error("/schema_version", "schema.version", "must equal 1");
        }
        let invariants = this.array(root["invariants"], "/invariants");
        let invariantIds = new Set<string>();
        if (invariants !== null) {
            invariants.forEach((item, index) => {
                let itemPath = `/invariants/${index}`;
                let invariantId = this.invariant(item, itemPath);
                if (invariantId) {
                    if (invariantIds.has(invariantId)) {
                        this.error(
                            `${itemPath}/id`,
                            "identity.duplicate-invariant",
                            `duplicate invariant id '${invariantId}'`,
                        );
                    }
                    invariantIds.add(invariantId);
                }
            });
        }
        return this.sortedDiagnostics();
    }

    sortedDiagnostics(): Diagnostic[] {
        return [...this.diagnostics].sort((left, right) => {
            return (
                compareStrings(left.path, right.path) ||
                compareStrings(left.code, right.code) ||
                compareStrings(left.message, right.message)
            );
        });
    }
}

export function parseManifestText(text: string): { document: unknown; diagnostics: Diagnostic[] } {
    try {
        return { document: parseJson(text), diagnostics: [] };
    } catch (error) {
        if (error instanceof DuplicateKeyError) {
            return {
                document: null,
                diagnostics: [
                    {
                        code: "manifest.duplicate-key",
                        message: `duplicate JSON object key: ${error.key}`,
                        path: "",
                    },
                ],
            };
        }
        if (error instanceof JsonSyntaxError) {
            return {
                document: null,
                diagnostics: [
                    {
                        code: "manifest.invalid-json",
                        message: `invalid JSON: ${error.msg}`,
                        path: "",
                    },
                ],
            };
        }
        throw error;
    }
}

// Python surfaces these through errno strerror text; Bun only carries the code.
let STRERROR: Record<string, string> = {
    EACCES: "Permission denied",
    ELOOP: "Too many levels of symbolic links",
    ENAMETOOLONG: "File name too long",
    ENOTDIR: "Not a directory",
    EPERM: "Operation not permitted",
};

export function readManifestText(path: string): string {
    let bytes = readFileSync(path);
    try {
        // ignoreBOM keeps a leading U+FEFF, which must fail as invalid JSON.
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        throw new InvalidEncodingError("must be UTF-8");
    }
}

export function loadManifest(path: string): { document: unknown; diagnostics: Diagnostic[] } {
    let text: string;
    try {
        text = readManifestText(path);
    } catch (error) {
        if (error instanceof InvalidEncodingError) {
            return {
                document: null,
                diagnostics: [
                    { code: "manifest.invalid-encoding", message: "must be UTF-8", path: "" },
                ],
            };
        }
        let code =
            typeof error === "object" && error !== null && "code" in error
                ? String(error.code)
                : "";
        if (code === "ENOENT") {
            return {
                document: null,
                diagnostics: [
                    { code: "manifest.missing", message: `file does not exist: ${path}`, path: "" },
                ],
            };
        }
        if (code === "EISDIR") {
            return {
                document: null,
                diagnostics: [
                    { code: "manifest.not-file", message: `not a regular file: ${path}`, path: "" },
                ],
            };
        }
        let reason = Object.hasOwn(STRERROR, code)
            ? STRERROR[code]
            : String(error instanceof Error ? error.message : error);
        return {
            document: null,
            diagnostics: [
                {
                    code: "manifest.unreadable",
                    message: `cannot read manifest: ${reason}`,
                    path: "",
                },
            ],
        };
    }
    return parseManifestText(text);
}

export type ParsedArguments = {
    manifest: string;
    root: string;
    json: boolean;
    help: boolean;
    error: string | null;
};

export function usageText(): string {
    return `usage: ${PROG} [-h] --root ROOT [--json] manifest`;
}

export function helpText(): string {
    return [
        usageText(),
        "",
        "Validate an invariant manifest; declared commands are never executed.",
        "",
        "positional arguments:",
        "  manifest",
        "",
        "options:",
        "  -h, --help   show this help message and exit",
        "  --root ROOT  project root used to resolve manifest references",
        "  --json       write deterministic JSON diagnostics",
    ].join("\n");
}

export function parseArguments(argv: string[]): ParsedArguments {
    let result: ParsedArguments = { manifest: "", root: "", json: false, help: false, error: null };
    let positionals: string[] = [];
    let unrecognized: string[] = [];
    let root: string | null = null;
    for (let index = 0; index < argv.length; index += 1) {
        let token = argv[index];
        if (token === "-h" || token === "--help") {
            result.help = true;
            return result;
        }
        if (token === "--json") {
            result.json = true;
        } else if (token === "--root") {
            if (index + 1 >= argv.length) {
                result.error = "argument --root: expected one argument";
                return result;
            }
            index += 1;
            root = argv[index];
        } else if (token.startsWith("--root=")) {
            root = token.slice("--root=".length);
        } else if (token.startsWith("-") && token !== "-") {
            unrecognized.push(token);
        } else {
            positionals.push(token);
        }
    }
    let missing: string[] = [];
    if (positionals.length === 0) {
        missing.push("manifest");
    }
    if (root === null) {
        missing.push("--root");
    }
    if (missing.length > 0) {
        result.error = `the following arguments are required: ${missing.join(", ")}`;
        return result;
    }
    unrecognized.push(...positionals.slice(1));
    if (unrecognized.length > 0) {
        result.error = `unrecognized arguments: ${unrecognized.join(" ")}`;
        return result;
    }
    result.manifest = positionals[0];
    result.root = root as string;
    return result;
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

export function main(argv: string[]): number {
    let args = parseArguments(argv);
    if (args.help) {
        console.log(helpText());
        return 0;
    }
    if (args.error !== null) {
        console.error(usageText());
        console.error(`${PROG}: error: ${args.error}`);
        return 2;
    }
    // Python normalizes both arguments through Path before use and display.
    let manifestPath = posixPathDisplay(args.manifest);
    let rootPath = posixPathDisplay(args.root);
    let document: unknown = null;
    let diagnostics: Diagnostic[];
    if (!existsSync(rootPath)) {
        diagnostics = [
            { code: "root.missing", message: `root does not exist: ${rootPath}`, path: "" },
        ];
    } else if (!isDirectory(rootPath)) {
        diagnostics = [
            {
                code: "root.not-directory",
                message: `root is not a directory: ${rootPath}`,
                path: "",
            },
        ];
    } else {
        let loaded = loadManifest(manifestPath);
        document = loaded.document;
        diagnostics = loaded.diagnostics;
    }
    if (diagnostics.length === 0) {
        diagnostics = new Validator(rootPath).validate(document);
    }
    let valid = diagnostics.length === 0;
    if (args.json) {
        console.log(encodeJsonReport(diagnostics, valid));
    } else if (valid) {
        console.log("Invariant manifest is well-formed. No declared checks were executed.");
    } else {
        for (let diagnostic of diagnostics) {
            let location = diagnostic.path || "/";
            console.error(`${location}: ${diagnostic.code}: ${diagnostic.message}`);
        }
    }
    return valid ? 0 : 1;
}

if (import.meta.main) {
    process.exitCode = main(process.argv.slice(2));
}
