// Loaded only by the compiled executable, and only through `require` from `keychain.ts`: Bun's
// runtime refuses to import a `.node` file, even `with { type: "file" }`, but its bundler
// embeds one imported that way and yields its `/$bunfs` path.
//
// `tools/build-keychain.ts` writes the file this names, and `tools/build-pico.ts` builds it
// before bundling, so the executable carries the addon a checkout compiled from
// `native/keychain/pico_keychain.m`.
import addon from "../../.build/keychain/pico_keychain.node" with { type: "file" };

export default addon;
