import { afterEach, describe, expect, test } from "bun:test";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { credentialIndexPath, lockedConnection, withCredentialLock } from "./coordination.ts";

const roots: string[] = [];

function temporaryRoot(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "pico-credential-lock-")));
    roots.push(root);
    return root;
}

function thrownBy(action: () => unknown): unknown {
    try {
        action();
        return undefined;
    } catch (error) {
        return error;
    }
}

const PROBE = join(import.meta.dir, "testing", "lock-probe.ts");

/** Another process's progress reaches this one only through the file it appends to. */
async function waitForLine(logPath: string, line: string): Promise<void> {
    for (let attempt = 0; attempt < 500; attempt += 1) {
        if (existsSync(logPath) && readFileSync(logPath, "utf8").includes(line)) return;
        await Bun.sleep(10);
    }
    throw new Error(`${line} never appeared in ${logPath}`);
}

afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("proposal.0009 the credential lock", () => {
    test("the first lock creates the data directory and its database, owner only", () => {
        const dataDir = join(temporaryRoot(), "Pico");

        withCredentialLock(dataDir, () => undefined);

        expect(statSync(dataDir).mode & 0o777).toBe(0o700);
        expect(statSync(credentialIndexPath(dataDir)).mode & 0o777).toBe(0o600);
    });

    test("the lock needs no credential tables and no credential rows", () => {
        const dataDir = join(temporaryRoot(), "Pico");

        const tables = withCredentialLock(dataDir, () =>
            lockedConnection(dataDir)
                .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
                .all()
                .map(row => row.name),
        );

        expect(tables).toEqual([]);
    });

    test("the lock passes the action's value through", () => {
        const dataDir = join(temporaryRoot(), "Pico");

        expect(withCredentialLock(dataDir, () => "settled")).toBe("settled");
    });

    test("it is reentrant for the same data directory in one process", () => {
        const dataDir = join(temporaryRoot(), "Pico");

        const depth = withCredentialLock(dataDir, () =>
            withCredentialLock(dataDir, () => withCredentialLock(dataDir, () => 3)),
        );

        expect(depth).toBe(3);
    });

    test("a nested action writes through the same transaction as its holder", () => {
        const dataDir = join(temporaryRoot(), "Pico");

        withCredentialLock(dataDir, () => {
            lockedConnection(dataDir).run("CREATE TABLE probe (value TEXT NOT NULL)");
            withCredentialLock(dataDir, () => {
                lockedConnection(dataDir).run("INSERT INTO probe (value) VALUES ('inner')");
            });
        });

        const saved = withCredentialLock(dataDir, () =>
            lockedConnection(dataDir).query<{ value: string }, []>("SELECT value FROM probe").all(),
        );
        expect(saved).toEqual([{ value: "inner" }]);
    });

    test("a throw rolls the whole transaction back", () => {
        const dataDir = join(temporaryRoot(), "Pico");
        withCredentialLock(dataDir, () => {
            lockedConnection(dataDir).run("CREATE TABLE probe (value TEXT NOT NULL)");
        });

        const failure = thrownBy(() =>
            withCredentialLock(dataDir, () => {
                lockedConnection(dataDir).run("INSERT INTO probe (value) VALUES ('rolled back')");
                throw new Error("abandoned");
            }),
        );

        expect((failure as Error).message).toBe("abandoned");
        const saved = withCredentialLock(dataDir, () =>
            lockedConnection(dataDir).query<{ value: string }, []>("SELECT value FROM probe").all(),
        );
        expect(saved).toEqual([]);
    });

    test("the locked connection is unavailable outside the lock", () => {
        const dataDir = join(temporaryRoot(), "Pico");

        expect(thrownBy(() => lockedConnection(dataDir))).toBeInstanceOf(Error);
    });

    test("separate data directories never wait for each other", () => {
        const first = join(temporaryRoot(), "Pico");
        const second = join(temporaryRoot(), "Pico");

        const nested = withCredentialLock(first, () => withCredentialLock(second, () => "both"));

        expect(nested).toBe("both");
    });

    test("a second process waits for the holder to commit", async () => {
        const root = temporaryRoot();
        const dataDir = join(root, "Pico");
        const logPath = join(root, "events.log");
        const release = join(root, "release");
        writeFileSync(logPath, "");

        const holder = Bun.spawn([process.execPath, PROBE, dataDir, logPath, "holder", release], {
            stdout: "pipe",
            stderr: "pipe",
        });
        await waitForLine(logPath, "holder-acquired");

        const waiter = Bun.spawn([process.execPath, PROBE, dataDir, logPath, "waiter"], {
            stdout: "pipe",
            stderr: "pipe",
        });
        await waitForLine(logPath, "waiter-attempting");
        writeFileSync(release, "");
        await Promise.all([holder.exited, waiter.exited]);

        const events = readFileSync(logPath, "utf8").trim().split("\n");
        expect(events.indexOf("holder-released")).toBeLessThan(events.indexOf("waiter-acquired"));
        expect(events).toContain("waiter-released");
    });
});
