/**
 * Reports why `line` is not an ACP message, or null when it is one.
 *
 * ACP's stdio transport is newline-delimited JSON-RPC, so a line that is not a request, a
 * notification or a response is output that escaped Pico's stdout isolation.
 */
export function acpMessageProblem(line: string): string | null {
    let message: unknown;
    try {
        message = JSON.parse(line);
    } catch {
        return "not JSON";
    }

    if (message === null || typeof message !== "object" || Array.isArray(message)) {
        return "not a JSON-RPC object";
    }

    let members = message as Record<string, unknown>;
    if (members.jsonrpc !== "2.0") return 'no "jsonrpc": "2.0" member';
    if (typeof members.method === "string") return null;
    if ("id" in members && ("result" in members || "error" in members)) return null;
    return "neither a request, a notification nor a response";
}

/**
 * Forwards `input` unchanged while reporting every newline-terminated line it carries.
 *
 * The bytes are passed straight through, so the protocol stream behaves exactly as it would
 * without the inspection.
 */
export function inspectLines(
    input: ReadableStream<Uint8Array>,
    onLine: (line: string) => void,
): ReadableStream<Uint8Array> {
    let decoder = new TextDecoder();
    let pending = "";

    function take(text: string): void {
        pending += text;
        for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
            onLine(pending.slice(0, end));
            pending = pending.slice(end + 1);
        }
    }

    return input.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                controller.enqueue(chunk);
                take(decoder.decode(chunk, { stream: true }));
            },
            flush() {
                take(decoder.decode());
                if (pending !== "") onLine(pending);
            },
        }),
    );
}
