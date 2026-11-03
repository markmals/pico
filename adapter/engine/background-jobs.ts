import type { AgentSession } from "@oh-my-pi/pi-coding-agent";

/** How long stopping waits for a job's processes; OMP sends SIGKILL about a second after SIGTERM. */
export const STOP_GRACE_MS = 5_000;

/** How often stopping checks whether a stopped job's processes are gone. */
const EXIT_CHECK_MS = 25;

/**
 * How long OMP has to end a stopped job's processes itself, before Pico sends SIGKILL to what
 * remains: OMP escalates a cancelled job to SIGKILL about a second after SIGTERM, but it never
 * signals a process a finished job left running (`sleep 60 & echo started`).
 */
const OMP_STOP_MS = 2_000;

/** The engine events after which Pico reads the processes jobs list. */
const RECORDING_EVENTS: readonly string[] = [
    "tool_execution_start",
    "tool_execution_update",
    "tool_execution_end",
    "message_end",
    "agent_end",
];

/** One engine session's background jobs, as a Pico turn waits for and stops them (proposal.0008). */
export class BackgroundJobs {
    readonly #engine: AgentSession;
    /**
     * Every live process a job has run, read while the job still listed it: a job lists its
     * processes only until it settles, and one the model kills through `proc://` settles at once.
     */
    readonly #processes = new Set<number>();
    /** The latest stop; a later one waits for it, so no caller returns while its processes run. */
    #stopping: Promise<boolean> = Promise.resolve(true);

    constructor(engine: AgentSession) {
        this.#engine = engine;
        // A tool call can end a job (`write proc://<id>/kill`) before Pico hears of the call, but
        // the job still lists its processes then; every tool call and every run boundary is a
        // chance to read them.
        engine.subscribe(event => {
            if (RECORDING_EVENTS.includes(event.type)) this.#recordProcesses();
        });
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
     * the next prompt. Resolves true once every process a job has run has exited, including any
     * that ignore SIGTERM, and false when one is still running after {@link STOP_GRACE_MS}.
     */
    stop(): Promise<boolean> {
        // Each stop checks every process recorded so far, so its outcome stands for the session.
        this.#stopping = this.#stopping.then(() => this.#stopAll());
        return this.#stopping;
    }

    async #stopAll(): Promise<boolean> {
        const engine = this.#engine;
        engine.suppressAutoResumeUntilPrompt();
        const deadline = Date.now() + STOP_GRACE_MS;
        // A job can start while an earlier one is being stopped, so stopping repeats until none runs.
        for (;;) {
            this.#recordProcesses();
            const running = engine.asyncJobManager?.getRunningJobs() ?? [];
            if (running.length === 0) break;
            for (const job of running) engine.cancelAsyncJob(job.id);
            if (!(await settlesBy(Promise.all(running.map(job => job.promise)), deadline))) {
                return false;
            }
        }
        const processes = [...this.#processes];
        if (!(await processesExit(processes, Math.min(deadline, Date.now() + OMP_STOP_MS)))) {
            for (const pid of processes) if (isAlive(pid)) kill(pid);
            if (!(await processesExit(processes, deadline))) return false;
        }
        this.#processes.clear();
        return true;
    }

    /** Adds every job's listed processes and forgets those that have exited, before their ids recur. */
    #recordProcesses(): void {
        for (const pid of this.#processes) if (!isAlive(pid)) this.#processes.delete(pid);
        for (const job of this.#engine.asyncJobManager?.getAllJobs() ?? []) {
            for (const pid of job.process?.pids() ?? []) this.#processes.add(pid);
        }
    }
}

/** Whether `work` settles by `deadline`. */
async function settlesBy(work: Promise<unknown>, deadline: number): Promise<boolean> {
    const expiry = Promise.withResolvers<false>();
    const timer = setTimeout(() => expiry.resolve(false), Math.max(0, deadline - Date.now()));
    try {
        return await Promise.race([work.then(() => true), expiry.promise]);
    } finally {
        clearTimeout(timer);
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

/**
 * Sends SIGKILL to a process OMP started and to its group. A live process whose parent is not
 * this one means the id was reused, so it is left alone; a group whose leader has exited is
 * still the job's, since an id is not reused while its group has members.
 */
function kill(pid: number): void {
    const parent = parentOf(pid);
    if (parent !== undefined && parent !== process.pid) return;
    for (const target of [-pid, pid]) {
        try {
            process.kill(target, "SIGKILL");
        } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
        }
    }
}

function parentOf(pid: number): number | undefined {
    const output = Bun.spawnSync(["/bin/ps", "-o", "ppid=", "-p", String(pid)]).stdout.toString();
    return output.trim() === "" ? undefined : Number(output.trim());
}
