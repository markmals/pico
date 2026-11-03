import type { z } from "zod/v4";

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

import { authLoginEventOutput } from "../result-schemas.ts";

type LoginEvent = z.infer<typeof authLoginEventOutput>;
const probe = join(import.meta.dir, "../../credentials/testing/login-process-probe.ts");
const marker = "FAKE-pico-process-probe-private-material";

// Windows does not deliver the POSIX cancellation signals this process contract exercises.
describe.skipIf(process.platform === "win32")("proposal.0009 supervised login process", () => {
    for (const mode of ["success", "sigint", "sigterm", "repeated", "broken"] as const) {
        test(`${mode} preserves the login output and cancellation contract`, async () => {
            const dataDir = mkdtempSync(join(tmpdir(), "pico-login-process-"));
            const child = Bun.spawn([process.execPath, probe, mode, dataDir], {
                env: {
                    HOME: userInfo().homedir,
                    PATH: "/usr/bin:/bin",
                    PI_CODING_AGENT_DIR: join(dataDir, "engine"),
                },
                stdin: "ignore",
                stdout: "pipe",
                stderr: "pipe",
                timeout: 15_000,
                killSignal: "SIGKILL",
            });
            const reader = child.stdout.getReader();
            const diagnostics = new Response(child.stderr).text();
            const decoder = new TextDecoder();
            const events: LoginEvent[] = [];
            let stdout = "";
            let buffered = "";
            try {
                let authorization: Extract<LoginEvent, { type: "authorization" }> | undefined;
                while (!authorization) {
                    const chunk = await reader.read();
                    if (chunk.done) throw new Error(`No authorization event: ${await diagnostics}`);
                    const text = decoder.decode(chunk.value, { stream: true });
                    stdout += text;
                    buffered += text;
                    let newline: number;
                    while ((newline = buffered.indexOf("\n")) >= 0) {
                        const event = authLoginEventOutput.parse(
                            JSON.parse(buffered.slice(0, newline)),
                        );
                        buffered = buffered.slice(newline + 1);
                        events.push(event);
                        if (event.type === "authorization") authorization = event;
                    }
                }
                expect(child.exitCode).toBeNull();
                expect(events[0]?.type).toBe("started");
                if (mode === "success") await fetch(authorization.url);
                else if (mode === "broken") {
                    await reader.cancel();
                    await fetch(new URL("/progress", authorization.url)).catch(error => {
                        if (
                            !(error instanceof TypeError) ||
                            !("code" in error) ||
                            error.code !== "ECONNRESET"
                        )
                            throw error;
                    });
                } else {
                    child.kill(mode === "sigint" ? "SIGINT" : "SIGTERM");
                    if (mode === "repeated") child.kill("SIGINT");
                }
                if (mode !== "broken") {
                    while (true) {
                        const chunk = await reader.read();
                        if (chunk.done) break;
                        const text = decoder.decode(chunk.value, { stream: true });
                        stdout += text;
                        buffered += text;
                    }
                    for (const line of buffered.trim().split("\n")) {
                        if (line) events.push(authLoginEventOutput.parse(JSON.parse(line)));
                    }
                }
                const exitCode = await child.exited;
                const stderr = await diagnostics;
                expect(stdout).not.toContain(marker);
                expect(stderr).not.toContain(marker);
                if (mode === "success") {
                    expect(exitCode).toBe(0);
                    expect(events.at(-1)).toMatchObject({ type: "completed", stored: true });
                    expect(stderr).toBe("");
                } else {
                    expect(exitCode).toBe(1);
                    const failed = authLoginEventOutput.parse({
                        type: "failed",
                        attemptId: authorization.attemptId,
                        sequence: 0,
                        ...JSON.parse(stderr.trimEnd().split("\n").at(-1)!),
                    });
                    expect(failed).toMatchObject({ type: "failed", error: { code: "CANCELLED" } });
                    expect(events.some(event => event.type === "completed")).toBe(false);
                    if (mode !== "broken")
                        expect(events.at(-1)).toMatchObject({
                            type: "failed",
                            error: { code: "CANCELLED" },
                        });
                }
            } finally {
                if (child.exitCode === null) child.kill("SIGKILL");
                await child.exited;
                rmSync(dataDir, { recursive: true, force: true });
            }
        }, 30_000);
    }
});
