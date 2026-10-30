// Derived from oh-my-pi 18.14.0 src/tools/write.ts (MIT; see THIRD-PARTY-NOTICES.md).
import { restoreLineEndings } from "@oh-my-pi/pi-coding-agent/edit/normalize";
import { BINARY_SNIFF_BYTES, isProbablyBinaryHeader } from "@oh-my-pi/pi-utils/binary";

/** Line-ending and BOM convention of a text file a write is about to replace. */
export interface TextFileConvention {
    bom: boolean;
    crlf: boolean;
}

/** Bytes read per step while looking for a first line break past the binary sniff window. */
const LINE_BREAK_SCAN_BYTES = 64 * 1024;

function leadingBom(bytes: Uint8Array): boolean {
    return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/**
 * The convention of the file `bytes` came from: a leading UTF-8 BOM, and CRLF
 * when its first line break is one. OMP reads this in chunks because it has not
 * loaded the file; Pico already holds every byte of the file it is replacing, so
 * the same rule reads straight from them.
 */
export function readTextFileConvention(bytes: Uint8Array): TextFileConvention {
    const lineFeed = bytes.indexOf(0x0a);
    return { bom: leadingBom(bytes), crlf: lineFeed > 0 && bytes[lineFeed - 1] === 0x0d };
}

/**
 * The same convention for a file too large to hold in memory, read from a bounded
 * prefix exactly as OMP reads it: the first sniff window decides whether the file
 * is text at all, then the scan walks forward in chunks until the first line break.
 * `undefined` for a binary file, whose bytes say nothing about text line endings.
 */
export async function scanTextFileConvention(
    absolutePath: string,
    size: number,
): Promise<TextFileConvention | undefined> {
    const file = Bun.file(absolutePath);
    let chunk = await file.slice(0, BINARY_SNIFF_BYTES).bytes();
    if (isProbablyBinaryHeader(chunk)) return undefined;
    const bom = leadingBom(chunk);
    let offset = 0;
    let previous: number | undefined;
    for (;;) {
        const lineFeed = chunk.indexOf(0x0a);
        if (lineFeed !== -1) {
            return { bom, crlf: (lineFeed > 0 ? chunk[lineFeed - 1] : previous) === 0x0d };
        }
        offset += chunk.length;
        if (chunk.length === 0 || offset >= size) return { bom, crlf: false };
        previous = chunk[chunk.length - 1];
        chunk = await file.slice(offset, offset + LINE_BREAK_SCAN_BYTES).bytes();
    }
}

/**
 * Give `content` the CRLF line endings and BOM of the file it replaces, as `edit`
 * keeps them. Models write LF text, so without this replacing a CRLF file rewrites
 * every line and drops its BOM. Each is independent: content with a carriage
 * return keeps its line endings, content that starts with a BOM keeps it, and
 * empty content stays empty.
 */
export function applyTextFileConvention(
    content: string,
    convention: TextFileConvention | undefined,
): string {
    if (!convention) return content;
    let text = content;
    if (convention.crlf && text.includes("\n") && !text.includes("\r")) {
        text = restoreLineEndings(text, "\r\n");
    }
    if (convention.bom && text.length > 0 && !text.startsWith("\uFEFF")) {
        text = `\uFEFF${text}`;
    }
    return text;
}
