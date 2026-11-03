import { isolateStdout } from "../../stdout-isolation.ts";

const stdout = isolateStdout();
const [
    { registerOAuthProvider },
    { runAuthLogin },
    { openCredentialVault },
    { createMemorySecretStore },
] = await Promise.all([
    import("@oh-my-pi/pi-ai/registry"),
    import("../../cli/commands/auth-login.ts"),
    import("../vault.ts"),
    import("./memory-secret-store.ts"),
]);

const [mode, dataDir] = process.argv.slice(2);
if (!dataDir) throw new Error("The login probe requires a scratch data directory");
const provider = "pico-login-process-probe";
const secret = "FAKE-pico-process-probe-private-material";
const keychain = createMemorySecretStore();
registerOAuthProvider({
    id: provider,
    name: "Synthetic login process probe",
    login: async controller => {
        const completion = Promise.withResolvers<{
            access: string;
            refresh: string;
            expires: number;
        }>();
        const server = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            fetch(request) {
                if (new URL(request.url).pathname === "/progress") {
                    controller.onProgress?.("Synthetic progress");
                    return new Response("progress");
                }
                completion.resolve({
                    access: secret,
                    refresh: "",
                    expires: Date.now() + 3_600_000,
                });
                return new Response("authorized");
            },
        });
        const stop = () => completion.reject(new DOMException("Stopped", "AbortError"));
        controller.signal?.addEventListener("abort", stop, { once: true });
        controller.onAuth({
            url: `http://127.0.0.1:${server.port}/authorize`,
            instructions: "Synthetic loopback approval",
        });
        try {
            return await completion.promise;
        } finally {
            controller.signal?.removeEventListener("abort", stop);
            await server.stop();
        }
    },
});

const writer = stdout.getWriter();
const encoder = new TextEncoder();
const exitCode = await runAuthLogin(
    {
        dataDir,
        openVault: () => openCredentialVault({ dataDir, keychain }),
        openCatalog: () => {
            throw new Error("The login probe never opens a model catalog");
        },
        readStdin: () => {
            throw new Error("The login probe never reads stdin");
        },
    },
    { arguments: { method: provider }, options: {} },
    {
        writeLine: text => writer.write(encoder.encode(text)),
        stderr: text => process.stderr.write(text),
    },
);
if (mode === "success" && exitCode !== 0) throw new Error("The control login failed");
process.exit(exitCode);
