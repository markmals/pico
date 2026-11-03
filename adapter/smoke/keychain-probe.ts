import { registerOAuthProvider } from "@oh-my-pi/pi-ai/registry/oauth";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createKeychain } from "../credentials/keychain.ts";
import { openCredentialVault } from "../credentials/vault.ts";

const [operation, dataDir, service, reference] = process.argv.slice(2);
if (!dataDir || !service?.startsWith("me.malstrom.pico.research.")) {
    throw new Error("The smoke requires a scratch data directory and synthetic Keychain service");
}
const beforeRefresh = "FAKE-pico-refresh-before-not-a-live-token";
const afterRefresh = "FAKE-pico-refresh-after-not-a-live-token";
const refreshSecret = "FAKE-pico-refresh-secret-not-a-live-token";
const provider = "pico-keychain-smoke";
const keychain = createKeychain({
    dataDir,
    service,
    allowKeychainUI: process.argv.includes("--allow-keychain-ui"),
});
const vault = openCredentialVault({ dataDir, keychain });

try {
    if (operation === "create") {
        const metadata = vault.create(provider, {
            type: "oauth",
            access: beforeRefresh,
            refresh: refreshSecret,
            expires: 1,
        });
        console.log(JSON.stringify({ operation, reference: metadata.reference }));
    } else if (operation === "refresh") {
        if (!reference) throw new Error("Missing scratch reference");
        registerOAuthProvider({
            id: provider,
            name: "Synthetic Keychain smoke provider",
            login: async () => {
                throw new Error("The smoke never logs in");
            },
            refreshToken: async () => ({
                access: afterRefresh,
                refresh: refreshSecret,
                expires: Date.now() + 3_600_000,
            }),
            getApiKey: credential => credential.access,
        });
        const auth = await vault.authStorage([reference]);
        try {
            const resolved = await auth.keys.get(provider);
            if (resolved !== afterRefresh)
                throw new Error("The refreshed credential was not resolved");
        } finally {
            auth.close();
        }
        console.log(JSON.stringify({ operation, persisted: true }));
    } else if (operation === "read") {
        if (!reference) throw new Error("Missing scratch reference");
        const stored = vault.read(reference);
        if (stored.credential.type !== "oauth" || stored.credential.access !== afterRefresh) {
            throw new Error("A restarted process did not read the refreshed credential");
        }
        console.log(JSON.stringify({ operation, persisted: true }));
    } else if (operation === "delete") {
        if (!reference) throw new Error("Missing scratch reference");
        vault.delete(reference);
        if (vault.metadata(reference) !== undefined || keychain.get(reference) !== null) {
            throw new Error("The synthetic item was not deleted");
        }
        console.log(JSON.stringify({ operation, deleted: true }));
    } else {
        throw new Error("Unknown smoke operation");
    }
    for (const filename of readdirSync(dataDir).filter(name => name.startsWith("credentials.db"))) {
        const bytes = readFileSync(join(dataDir, filename));
        for (const forbidden of [beforeRefresh, afterRefresh, refreshSecret]) {
            if (bytes.includes(forbidden))
                throw new Error("Secret material reached metadata storage");
        }
    }
} catch (error) {
    const failure = error as {
        code?: string;
        message?: string;
        details?: { keychain?: string; status?: number };
    };
    console.error(
        JSON.stringify({
            error: {
                code: failure.code ?? "INTERNAL",
                message: failure.message ?? "Synthetic Keychain operation failed",
                keychain: failure.details?.keychain,
                status: failure.details?.status,
            },
        }),
    );
    process.exitCode = 1;
} finally {
    vault.close();
}
