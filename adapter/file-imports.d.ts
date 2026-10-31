// `carried-addon.ts` imports the native addon `with { type: "file" }`, which yields the
// file's path under `/$bunfs` in the compiled executable.
declare module "*.node" {
    const path: string;
    export default path;
}

// Installed only on Apple silicon Macs; elsewhere, type-checking `carried-addon.ts` falls
// back to this declaration.
declare module "@oh-my-pi/pi-natives-darwin-arm64/package.json" {
    const manifest: { version: string };
    export default manifest;
}
