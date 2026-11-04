import { readSync, writeSync } from "node:fs";

const buffer = Buffer.alloc(1024);
let lines = 0;
while (lines < 2) {
    const count = readSync(0, buffer, 0, buffer.byteLength, null);
    if (count === 0) throw new Error("Login output ended before the authorization event");
    writeSync(1, buffer.subarray(0, count));
    for (let index = 0; index < count; index++) {
        if (buffer[index] === 10) lines++;
    }
}
process.exit(0);
