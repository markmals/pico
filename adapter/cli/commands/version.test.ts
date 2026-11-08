import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { z } from "zod/v4";

import manifest from "../../../package.json" with { type: "json" };
import { versionGetOutput } from "../result-schemas.ts";
import { input } from "./testing.ts";
import { versionGet } from "./version.ts";

/** The engine package as installed, read from disk rather than through Oh My Pi's own export. */
function installedEngineVersion(): string {
    const path = Bun.resolveSync("@oh-my-pi/pi-coding-agent/package.json", import.meta.dir);
    return z.object({ version: z.string() }).parse(JSON.parse(readFileSync(path, "utf8"))).version;
}

describe("pico version get", () => {
    test("reports Pico's own version and the Oh My Pi engine it runs", async () => {
        const result = versionGetOutput.parse({ apiVersion: 1, ...(await versionGet()(input())) });

        expect(result.item).toEqual({ pico: manifest.version, omp: installedEngineVersion() });
    });
});
