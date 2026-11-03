export type ValueFormat = "model" | "revision" | "text";

const REVISION = /^(none|sha256:[0-9a-f]{64})$/;

const FORMATS: Record<ValueFormat, { accepts: (raw: string) => boolean; description: string }> = {
    model: {
        accepts: raw => {
            const slash = raw.indexOf("/");
            return slash > 0 && slash < raw.length - 1;
        },
        description: "provider/id, such as anthropic/claude-sonnet-5-5",
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
