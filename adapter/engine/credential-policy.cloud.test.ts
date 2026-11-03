import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CloudPolicyReport } from "./testing/cloud-policy-probe.ts";

const PROBE = join(import.meta.dir, "testing", "cloud-policy-probe.ts");

const roots: string[] = [];

function scratchRoot(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-cloud-policy-")));
    roots.push(root);
    return root;
}

/**
 * Runs the policy probe in its own process, rooted entirely in scratch directories and armed
 * with fabricated AWS credentials.
 *
 * The fabrications matter: `hasAwsCredentialSource` treats an access key and secret, or a
 * Bedrock bearer token, as a usable credential source without reading a file or reaching the
 * network, so the environment route a self-authenticating transport would take is genuinely
 * open. Every path that could reach the human's own configuration — the AWS profile and config
 * files, Google application default credentials, the gcloud configuration, instance metadata —
 * is pointed at a scratch path or switched off.
 */
async function probe(): Promise<CloudPolicyReport> {
    const root = scratchRoot();
    const home = join(root, "home");
    const dataDir = join(root, "Pico");
    mkdirSync(home, { recursive: true });
    const child = Bun.spawn([process.execPath, "run", PROBE, dataDir], {
        cwd: root,
        env: {
            PATH: process.env.PATH ?? "",
            HOME: home,
            PI_CODING_AGENT_DIR: join(home, "agent"),
            AWS_SHARED_CREDENTIALS_FILE: join(home, "aws-credentials"),
            AWS_CONFIG_FILE: join(home, "aws-config"),
            GOOGLE_APPLICATION_CREDENTIALS: join(home, "gcloud.json"),
            CLOUDSDK_CONFIG: join(home, "gcloud"),
            XDG_CONFIG_HOME: join(home, "config"),
            AWS_EC2_METADATA_DISABLED: "true",
            // Fabricated, and never sent anywhere: no request is made in this test.
            AWS_ACCESS_KEY_ID: "AKIAPICOFAKEACCESSKEY",
            AWS_SECRET_ACCESS_KEY: "pico-fake-secret-access-key",
            AWS_BEARER_TOKEN_BEDROCK: "pico-fake-bedrock-bearer",
            AWS_REGION: "us-east-1",
        },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, error, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    if (status !== 0) throw new Error(`the policy probe exited ${status}: ${error}`);
    return JSON.parse(out) as CloudPolicyReport;
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("proposal.0009 a remote provider that authenticates itself", () => {
    test("none resolves a credential from the machine's own configuration while Pico has bound nothing", async () => {
        const report = await probe();

        // The fabricated AWS environment really does open an ambient route, so the refusal
        // below is about a provider that could otherwise have been served, not an empty set.
        expect(report.ambient).not.toEqual([]);
        expect(report.resolved).toEqual([]);
    });

    test("none is offered as an available model provider either, so discovery never probes one", async () => {
        const report = await probe();

        expect(report.ambient).not.toEqual([]);
        expect(report.available).toEqual([]);
    });

    test("genuinely keyless local discovery still resolves without any credential", async () => {
        const report = await probe();

        // The SDK's implicit local providers answer with its no-auth sentinel; `lm-studio` among
        // them is what the offline smoke runs on, and none of them is a remote provider.
        expect(report.localDiscovery).not.toEqual([]);
        for (const { provider, resolved } of report.localDiscovery) {
            expect([provider, resolved]).toEqual([provider, "N/A"]);
            expect(report.remote).not.toContain(provider);
        }
    });

    test("the SDK's virtual providers keep resolving, and gain no ambient route doing so", async () => {
        const report = await probe();

        // `local` hosts models the runtime serves itself and `web` backs the web-search tool,
        // whose policy this proposal does not change. Neither is a vendor endpoint, so neither
        // may acquire a credential source from the machine's configuration.
        expect(report.virtual.map(entry => entry.provider)).toEqual(["local", "web"]);
        for (const { provider, resolved, ambient } of report.virtual) {
            expect([provider, resolved, ambient]).toEqual([provider, "N/A", false]);
            expect(report.remote).not.toContain(provider);
        }
    });
});
