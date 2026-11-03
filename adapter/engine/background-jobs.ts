import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

/** How long stopping waits for a job's processes; OMP sends SIGKILL about a second after SIGTERM. */
export const STOP_GRACE_MS = 5_000;

/** How often stopping checks whether a stopped job's processes are gone. */
const EXIT_CHECK_MS = 25;

/** One engine session's background jobs, as a Pico turn waits for and stops them (proposal.0008). */
export class BackgroundJobs {
    readonly #engine: AgentSession;
    /** The latest stop; a later one waits for it, so no caller returns while its processes run. */
    #stopping: Promise<boolean> = Promise.resolve(true);

    constructor(engine: AgentSession) {
        this.#engine = engine;
    }

    /**
     * Resolves once no job runs, no finished job's result is still on its way to the model, and
     * the engine is idle. OMP delivers a finished job's result by starting a run of its own, and
     * waiting here keeps that run inside the caller's turn. Returns as soon as `stopRequested()`
     * holds, leaving the jobs to whoever stops them.
     */
    async settle(stopRequested: () => boolean): Promise<void> {
        const engine = this.#engine;
        for (;;) {
            await engine.waitForIdle();
            if (stopRequested()) return;
            const running = engine.asyncJobManager?.getRunningJobs() ?? [];
            if (running.length > 0) {
                // Every job, including one whose result goes to a `wait` and so wakes no run.
                await Promise.race(running.map(job => job.promise));
                continue;
            }
            if (!engine.hasPendingAsyncWork()) return;
            await engine.settleAsyncWork();
        }
    }

    /**
     * Stops every running job and keeps the results of finished ones from starting a run until
     * the next prompt. Resolves true once the processes the jobs started have exited, including
     * any that ignore SIGTERM, and false when one is still running after {@link STOP_GRACE_MS}.
     */
    stop(): Promise<boolean> {
        const previous = this.#stopping;
        this.#stopping = previous.then(async stopped => (await this.#stopRunning()) && stopped);
        return this.#stopping;
    }

    async #stopRunning(): Promise<boolean> {
        const engine = this.#engine;
        engine.suppressAutoResumeUntilPrompt();
        const deadline = Date.now() + STOP_GRACE_MS;
        // A job can start while an earlier one is being stopped, so stopping repeats until none runs.
        for (;;) {
            const running = engine.asyncJobManager?.getRunningJobs() ?? [];
            if (running.length === 0) return true;
            // A job lists its processes only while it runs, so they are read before it is cancelled.
            const processes = running.flatMap(job => job.process?.pids() ?? []);
            for (const job of running) engine.cancelAsyncJob(job.id);
            await Promise.all(running.map(job => job.promise));
            if (!(await processesExit(processes, deadline))) return false;
        }
    }
}

/**
 * Whether every process, and every process in its group, has exited by `deadline`. OMP announces
 * nothing when a process it signalled exits, so this checks the operating system until it does.
 */
async function processesExit(pids: readonly number[], deadline: number): Promise<boolean> {
    while (pids.some(isAlive)) {
        if (Date.now() >= deadline) return false;
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, EXIT_CHECK_MS);
        await promise;
    }
    return true;
}

/** OMP starts each command in a process group of its own, which the command's children share. */
function isAlive(pid: number): boolean {
    return signalReaches(pid) || signalReaches(-pid);
}

function signalReaches(target: number): boolean {
    try {
        process.kill(target, 0);
        return true;
    } catch (error) {
        // EPERM means the process exists but belongs to someone else: it is still running.
        return !(error instanceof Error && "code" in error && error.code === "ESRCH");
    }
}
