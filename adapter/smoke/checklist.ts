interface Entry {
    name: string;
    problem: string | null;
}

/** The smoke run's pass/fail list, in the order the checks were made. */
export class Checklist {
    #entries: Entry[] = [];

    /** Records one check: `problem` is null when it passed, and the reason when it failed. */
    record(name: string, problem: string | null): void {
        this.#entries.push({ name, problem });
    }

    get passed(): boolean {
        return this.#entries.every(entry => entry.problem === null);
    }

    report(): string {
        return this.#entries
            .map(entry =>
                entry.problem === null
                    ? `PASS  ${entry.name}`
                    : `FAIL  ${entry.name} — ${entry.problem}`,
            )
            .join("\n");
    }
}
