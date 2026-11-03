import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";

/**
 * Writes `content` to a new file beside `target` and renames it over `target`, so a reader sees
 * either the previous file or the complete new one, never a half-written one. The temporary file
 * is created in the target's directory, because a rename across file systems is a copy, and it is
 * removed when any step fails. The operating system's error reaches the caller, which names what
 * it was writing.
 */
export function writeAtomically(target: string, content: Uint8Array, mode: number): void {
    const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    const file = openSync(temporary, "wx", mode);
    try {
        writeAndClose(file, content);
        renameSync(temporary, target);
    } catch (error) {
        rmSync(temporary, { force: true });
        throw error;
    }
}

/** Flushes the bytes to disk, closing the descriptor whether or not that succeeds. */
function writeAndClose(file: number, content: Uint8Array): void {
    try {
        writeFileSync(file, content);
        fsyncSync(file);
    } finally {
        closeSync(file);
    }
}
