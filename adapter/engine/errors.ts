/** Thrown for every session-creation failure; `message` is shown to the user as-is. */
export class PicoSessionError extends Error {}

export function describeCause(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Captures a release failure so the remaining owned resources can still be released. */
export async function attempt(
    step: () => Promise<void> | void,
): Promise<{ error: unknown } | undefined> {
    try {
        await step();
        return undefined;
    } catch (error) {
        return { error };
    }
}
