export type ValueFormat = "model" | "provider" | "reference" | "revision" | "text";

const REVISION = /^(none|sha256:[0-9a-f]{64})$/;
const PROVIDER = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const REFERENCE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

const FORMATS: Record<ValueFormat, { accepts: (raw: string) => boolean; description: string }> = {
    model: {
        accepts: raw => {
            const slash = raw.indexOf("/");
            return slash > 0 && slash < raw.length - 1;
        },
        description: "provider/id, such as anthropic/claude-sonnet-5-5",
    },
    provider: {
        accepts: raw => PROVIDER.test(raw),
        description: "a provider id, such as openai-codex",
    },
    reference: {
        accepts: raw => REFERENCE.test(raw),
        description: "a credential reference, as pico credentials list prints it",
    },
    revision: {
        accepts: raw => REVISION.test(raw),
        description: "none, or sha256: followed by 64 lowercase hexadecimal characters",
    },
    text: {
        accepts: raw => raw.trim().length > 0,
        description: "a value that is not empty",
    },
};

export function isValidValue(format: ValueFormat, raw: string): boolean {
    return FORMATS[format].accepts(raw);
}

export function describeValueFormat(format: ValueFormat): string {
    return FORMATS[format].description;
}
