import { describe, expect, test } from "bun:test";

import { CliError } from "./errors.ts";
import { writeError, writeResult } from "./output.ts";

function recorder(stdoutIsTerminal = false) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
        io: {
            stdout: (text: string) => void stdout.push(text),
            stderr: (text: string) => void stderr.push(text),
            stdoutIsTerminal,
        },
        get out() {
            return stdout.join("");
        },
        get err() {
            return stderr.join("");
        },
    };
}

describe("proposal.0007 command line output", () => {
    test("a result is one compact JSON document and a newline, apiVersion first", () => {
        const recording = recorder();

        writeResult(recording.io, { query: "models", items: [] });

        expect(recording.out).toBe('{"apiVersion":1,"query":"models","items":[]}\n');
        expect(recording.err).toBe("");
    });

    test("a result is indented by two spaces when stdout is a terminal", () => {
        const recording = recorder(true);

        writeResult(recording.io, { items: [1] });

        expect(recording.out).toBe('{\n  "apiVersion": 1,\n  "items": [\n    1\n  ]\n}\n');
    });

    test("a result carries exactly one document", () => {
        const recording = recorder();

        writeResult(recording.io, { items: [] });

        expect(recording.out.trimEnd().split("\n").length).toBe(1);
        expect(JSON.parse(recording.out)).toEqual({ apiVersion: 1, items: [] });
    });

    test("a failure leaves stdout empty and ends stderr with the error document", () => {
        const recording = recorder();

        recording.io.stderr("pico: reading the settings file\n");
        const exitCode = writeError(
            recording.io,
            new CliError("IO_ERROR", "settings.json could not be read", {
                details: { settingsFile: "/s.json", cause: "EACCES" },
            }),
        );

        expect(recording.out).toBe("");
        expect(exitCode).toBe(1);
        const lines = recording.err.trimEnd().split("\n");
        expect(lines[0]).toBe("pico: reading the settings file");
        expect(JSON.parse(lines[lines.length - 1] as string)).toEqual({
            apiVersion: 1,
            error: {
                code: "IO_ERROR",
                message: "settings.json could not be read",
                retryable: false,
                details: { settingsFile: "/s.json", cause: "EACCES" },
            },
        });
    });

    test("the error document is compact on one line, even on a terminal", () => {
        const recording = recorder(true);

        writeError(recording.io, new CliError("INTERNAL", "boom"));

        expect(recording.err.trimEnd().includes("\n")).toBe(false);
        expect(recording.err.endsWith("\n")).toBe(true);
    });

    test("an invalid argument exits 2 and every other failure exits 1", () => {
        expect(writeError(recorder().io, new CliError("INVALID_ARGUMENT", "no such option"))).toBe(
            2,
        );
        expect(writeError(recorder().io, new CliError("CONFLICT", "the file moved"))).toBe(1);
    });
});
