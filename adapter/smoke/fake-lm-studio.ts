// The offline model `mise run pico:verify` drives: an OpenAI-compatible server that OMP's
// built-in LM Studio provider discovers through `LM_STUDIO_BASE_URL`, so a whole turn runs
// with no credentials, no network and no OMP extension (proposal.0007).

export interface FakeLmStudioOptions {
    /** Echoed back through a tool call, then recognised in the history on a later prompt. */
    memoryToken: string;
    /** The assistant text that ends the turn, once the tool results are in. */
    reply: string;
}

export interface FakeLmStudio {
    /** The value for `LM_STUDIO_BASE_URL`; OMP appends `/models` and `/chat/completions` to it. */
    baseUrl: string;
    stop(): void;
}

/** The one model offered, which Pico names `lm-studio/echo`. */
const MODEL_ID = "echo";

interface ChatMessage {
    role?: unknown;
    content?: unknown;
}

interface ScriptedToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

type ScriptedTurn = { text: string } | { toolCalls: ScriptedToolCall[] };

export function startFakeLmStudio(options: FakeLmStudioOptions): FakeLmStudio {
    const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: request => serve(request, options),
    });
    return {
        baseUrl: `http://127.0.0.1:${server.port}/v1`,
        stop: () => {
            void server.stop(true);
        },
    };
}

/**
 * LM Studio's native listings (`/api/v0/models`, `/api/v1/models`) fall through to the 404
 * below: discovery probes them under a 250 ms budget and treats any failure as "no native
 * metadata", so refusing them answers that probe as fast as the loopback allows.
 */
async function serve(request: Request, options: FakeLmStudioOptions): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/v1/models") {
        return Response.json({ object: "list", data: [{ id: MODEL_ID, object: "model" }] });
    }
    if (request.method === "POST" && pathname === "/v1/chat/completions") {
        const body = (await request.json()) as { messages?: ChatMessage[] };
        return eventStream(completionChunks(script(body.messages ?? [], options)));
    }
    return new Response("not found", { status: 404 });
}

/** The scripted model: write the token and open a todo for it, then answer, then remember. */
function script(messages: ChatMessage[], options: FakeLmStudioOptions): ScriptedTurn {
    const { memoryToken, reply } = options;
    const users = messages.filter(message => message.role === "user");
    if (users.length > 1) {
        const remembered = users
            .slice(0, -1)
            .some(message => JSON.stringify(message.content).includes(memoryToken));
        return { text: remembered ? `remembered:${memoryToken}` : "history missing" };
    }
    if (messages.at(-1)?.role === "user") {
        return {
            toolCalls: [
                {
                    id: "verify-write",
                    name: "write",
                    arguments: { path: "restart-note.txt", content: `${memoryToken}\n` },
                },
                {
                    id: "verify-todo",
                    name: "todo",
                    arguments: { op: "init", items: [`Remember ${memoryToken}`] },
                },
            ],
        };
    }
    return { text: reply };
}

function completionChunks(turn: ScriptedTurn): unknown[] {
    const envelope = {
        id: "chatcmpl-pico-verify",
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: MODEL_ID,
    };
    const choice = (delta: unknown, finishReason: string | null) => ({
        ...envelope,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
    });
    const chunks: unknown[] = [choice({ role: "assistant" }, null)];
    if ("text" in turn) {
        chunks.push(choice({ content: turn.text }, null), choice({}, "stop"));
    } else {
        for (const [index, call] of turn.toolCalls.entries()) {
            const tool = {
                index,
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            };
            chunks.push(choice({ tool_calls: [tool] }, null));
        }
        chunks.push(choice({}, "tool_calls"));
    }
    // `stream_options.include_usage` is always requested, and the trailing usage-only chunk
    // is what lets the client stop reading without waiting out the post-finish grace window.
    chunks.push({
        ...envelope,
        choices: [],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    return chunks;
}

function eventStream(chunks: unknown[]): Response {
    const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("");
    return new Response(`${body}data: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
    });
}
