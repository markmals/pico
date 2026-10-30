import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { findUnexpectedTools } from "./tool-roster.ts";

/** Deterministic rosters whose membership overlaps in every combination. */
function generatedRosters(
    seed: number,
    count: number,
): Array<{ active: string[]; allowed: string[] }> {
    const pool = [
        "read",
        "bash",
        "write",
        "mcp__sesh_notify",
        "mcp__fake_echo",
        "eval",
        "task",
        "lsp",
    ];
    let state = seed;
    const next = (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
    };
    return Array.from({ length: count }, () => ({
        active: pool.filter(() => next() < 0.5),
        allowed: pool.filter(() => next() < 0.5),
    }));
}

describe("proposal.0001 roster guard", () => {
    test("an active roster inside the allowlist has nothing unexpected", () => {
        assert.deepEqual(findUnexpectedTools(["read", "bash"], ["read", "bash", "write"]), []);
    });

    test("active tools outside the allowlist are named", () => {
        assert.deepEqual(findUnexpectedTools(["read", "eval", "task"], ["read", "bash"]), [
            "eval",
            "task",
        ]);
    });

    test("an allowed tool the engine never admitted is not reported", () => {
        assert.deepEqual(findUnexpectedTools(["read"], ["read", "find"]), []);
    });

    test("a repeated unexpected tool is named once, in the order it was active", () => {
        assert.deepEqual(findUnexpectedTools(["task", "read", "eval", "task"], ["read"]), [
            "task",
            "eval",
        ]);
    });

    test("for any rosters, the result is exactly the active tools the allowlist omits", () => {
        for (const { active, allowed } of generatedRosters(0xc0ffee, 32)) {
            const unexpected = findUnexpectedTools(active, allowed);
            const allowedSet = new Set(allowed);
            for (const name of unexpected) {
                assert.ok(active.includes(name), `${name} was reported but never active`);
                assert.ok(!allowedSet.has(name), `${name} was reported but is allowed`);
            }
            for (const name of active) {
                if (allowedSet.has(name)) continue;
                assert.ok(
                    unexpected.includes(name),
                    `${name} is active, not allowed, and went unreported`,
                );
            }
        }
    });
});
