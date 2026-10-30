/**
 * Just enough BMP to avoid an image library.
 *
 * `sips` does the decoding and scaling; what it hands back is a flat, uncompressed
 * bitmap whose header is four fields deep. Both `apple-ref.ts` (is this frame blank?)
 * and `contact-sheet.ts` (compose a grid) read captures through here.
 */

export type Bitmap = {
    readonly width: number;
    readonly height: number;
    /** Top-down scanlines of packed RGB, three bytes per pixel. */
    readonly rows: readonly Buffer[];
};

export function parseBmp(data: Buffer, label = "bitmap"): Bitmap {
    const offset = data.readUInt32LE(10);
    const width = data.readInt32LE(18);
    const signedHeight = data.readInt32LE(22);
    const depth = data.readUInt16LE(28);
    if (depth !== 24 && depth !== 32) {
        throw new Error(`unexpected BMP depth ${depth} in ${label}`);
    }
    const step = depth / 8;
    // A positive height means the scanlines are stored bottom-up.
    const bottomUp = signedHeight > 0;
    const height = Math.abs(signedHeight);
    const stride = Math.floor((width * step + 3) / 4) * 4;
    const rows: Buffer[] = [];
    for (let y = 0; y < height; y += 1) {
        const start = offset + y * stride;
        const row = Buffer.allocUnsafe(width * 3);
        for (let x = 0; x < width; x += 1) {
            const pixel = start + x * step;
            // BMP stores BGR(A); swap to RGB and drop any alpha.
            row[x * 3] = data[pixel + 2] ?? 0;
            row[x * 3 + 1] = data[pixel + 1] ?? 0;
            row[x * 3 + 2] = data[pixel] ?? 0;
        }
        rows.push(row);
    }
    if (bottomUp) {
        rows.reverse();
    }
    return { width, height, rows };
}

/**
 * The share of the image covered by its most common colour, with each channel
 * quantised into 24-wide buckets.
 *
 * Measuring the colour *range* does not work: a black screen with a white status bar
 * spans the full range while showing nothing. Dominant-colour coverage does, and it
 * still passes a sparse but real screen such as an empty state.
 */
export function dominantCoverage(bitmap: Bitmap): number {
    const counts = new Map<number, number>();
    let total = 0;
    for (const row of bitmap.rows) {
        for (let x = 0; x < bitmap.width; x += 1) {
            const red = Math.floor((row[x * 3] ?? 0) / 24);
            const green = Math.floor((row[x * 3 + 1] ?? 0) / 24);
            const blue = Math.floor((row[x * 3 + 2] ?? 0) / 24);
            const key = (red << 16) | (green << 8) | blue;
            counts.set(key, (counts.get(key) ?? 0) + 1);
            total += 1;
        }
    }
    if (total === 0) {
        return 0;
    }
    let dominant = 0;
    for (const count of counts.values()) {
        if (count > dominant) {
            dominant = count;
        }
    }
    return dominant / total;
}
