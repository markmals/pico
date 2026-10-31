// Loaded only by the compiled executable. Bun's runtime refuses to import a `.node` file,
// even `with { type: "file" }`, but its bundler embeds one imported that way and yields its
// `/$bunfs` path. The platform package carries the version Oh My Pi's loader looks for:
// `@oh-my-pi/pi-natives` pins it exactly and exports no package.json of its own.
import natives from "@oh-my-pi/pi-natives-darwin-arm64/package.json" with { type: "json" };
import addon from "@oh-my-pi/pi-natives-darwin-arm64/pi_natives.darwin-arm64.node" with { type: "file" };

export default { path: addon, version: natives.version };
