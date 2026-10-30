// Derived from oh-my-pi 18.14.0 src/tools/write.ts (MIT; see THIRD-PARTY-NOTICES.md).
import { restoreLineEndings } from "@oh-my-pi/pi-coding-agent/edit/normalize";

/** Line-ending and BOM convention of a text file a write is about to replace. */
export interface TextFileConvention {
    bom: boolean;
    crlf: boolean;
}

/**
 * The convention of the file `bytes` came from: a leading UTF-8 BOM, and CRLF
 * when its first line break is one. OMP reads this in chunks because it has not
 * loaded the file; Pico already holds every byte of the file it is replacing, so
 * the same rule reads straight from them.
 */
export function readTextFileConvention(bytes: Uint8Array): TextFileConvention {
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const lineFeed = bytes.indexOf(0x0a);
    return { bom, crlf: lineFeed > 0 && bytes[lineFeed - 1] === 0x0d };
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
