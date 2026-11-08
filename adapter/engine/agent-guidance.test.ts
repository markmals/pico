import { describe, expect, test } from "bun:test";

import type { IntellisenseLocation } from "../intellisense/location.ts";

import { picoGuidance } from "./agent-guidance.ts";

function firstBullet(location: IntellisenseLocation): string {
    return picoGuidance(location).split("\n")[1] ?? "";
}

const FOUND: IntellisenseLocation = {
    status: "found",
    source: "settings",
    path: "/Users/pico/.cargo/bin/intellisense",
};

describe("pico-bfk.20 what the guidance says about intellisense", () => {
    test("a found location names the path and how to run it", () => {
        expect(firstBullet(FOUND)).toBe(
            "- Code intelligence comes from the `intellisense` CLI at /Users/pico/.cargo/bin/intellisense:" +
                " run it through `bash` as /Users/pico/.cargo/bin/intellisense, since it may not be on `PATH`.",
        );
    });

    test("a path needing quoting is shell-quoted for the command, and shown verbatim", () => {
        const bullet = firstBullet({
            status: "found",
            source: "discovered",
            path: "/Users/pico/my tools/intellisense",
        });

        expect(bullet).toContain("CLI at /Users/pico/my tools/intellisense:");
        expect(bullet).toContain("run it through `bash` as '/Users/pico/my tools/intellisense',");
    });

    test("a missing location tells the agent not to look for another copy", () => {
        expect(
            firstBullet({
                status: "missing",
                source: "discovered",
                path: null,
                searched: ["/usr/bin", "/bin"],
                problem: "No intellisense executable in /usr/bin, /bin",
            }),
        ).toBe(
            "- Code intelligence comes from the `intellisense` CLI, but Pico has no usable copy: No intellisense executable in /usr/bin, /bin." +
                " Don't search for another copy. When you need it, tell the user to choose it in Pico's" +
                " Tools & Integrations settings or with `pico settings update --intellisense-path`.",
        );
    });

    test("an unusable location carries its own problem into the same sentence", () => {
        expect(
            firstBullet({
                status: "unusable",
                source: "settings",
                path: "/opt/intellisense",
                problem: "/opt/intellisense is not executable",
            }),
        ).toStartWith(
            "- Code intelligence comes from the `intellisense` CLI, but Pico has no usable copy: /opt/intellisense is not executable.",
        );
    });

    test("only the first bullet depends on the location", () => {
        const found = picoGuidance(FOUND).split("\n").slice(2);
        const missing = picoGuidance({
            status: "missing",
            source: "discovered",
            path: null,
            searched: ["/bin"],
            problem: "No intellisense executable in /bin",
        })
            .split("\n")
            .slice(2);

        expect(found).toEqual(missing);
        expect(picoGuidance(FOUND).split("\n")[0]).toBe("§ Pico");
        expect(found.some(line => line.includes("mcp__sesh_start_session"))).toBe(true);
    });
});
