interface CacheEntry {
    value: string;
    expiresAtSec: number;
}

/**
 * The key/value cache the SDK's credential services share. Pico keeps it in
 * memory for the life of one store: usage reports and similar derived values can
 * carry account detail, and a durable copy would be a second place credential
 * state lives. Nothing here survives the process.
 */
export class ExpiringCache {
    readonly #entries = new Map<string, CacheEntry>();

    get(key: string, options?: { includeExpired?: boolean }): string | null {
        const entry = this.#entries.get(key);
        if (!entry) return null;
        if (!options?.includeExpired && entry.expiresAtSec <= Math.floor(Date.now() / 1000)) {
            return null;
        }
        return entry.value;
    }

    set(key: string, value: string, expiresAtSec: number): void {
        this.#entries.set(key, { value, expiresAtSec });
    }

    deletePrefix(prefix: string): void {
        for (const key of this.#entries.keys()) {
            if (key.startsWith(prefix)) this.#entries.delete(key);
        }
    }

    cleanExpired(): void {
        const now = Math.floor(Date.now() / 1000);
        for (const [key, entry] of this.#entries) {
            if (entry.expiresAtSec <= now) this.#entries.delete(key);
        }
    }

    clear(): void {
        this.#entries.clear();
    }
}
