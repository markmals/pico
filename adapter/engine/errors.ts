/** Thrown for every session-creation failure; `message` is shown to the user as-is. */
export class PicoSessionError extends Error {}

export function describeCause(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
