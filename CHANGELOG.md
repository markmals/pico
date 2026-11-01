# pico

## 0.1.0

### Minor Changes

- af068f7: Ship Pico as `pico`, a single executable you install with `brew install markmals/tap/pico` on an Apple silicon Mac running macOS 14 or later, and register in Sesh as `/opt/homebrew/bin/pico`. `pico --version` prints its version; running it at a terminal prints its usage instead of waiting for Sesh. Pico now keeps the files it creates, OMP's native addon and the model cache, in `~/Library/Application Support/Pico` instead of `~/.omp`. The repository is MIT licensed, and `THIRD-PARTY-NOTICES.md` lists everything `pico` bundles.
- 329a486: Add the Pico ACP adapter, a stdio agent that Sesh can launch as a custom agent; `mise run acp:launcher` writes it to `.build/pico-acp`. It runs Oh My Pi with your existing configuration and credentials, starting on your default model, and Sesh's Model and Thinking menus switch the model and thinking level for a session. Its tools are `read`, `grep`, `glob`, `edit`, `write`, `bash` and `web_search`, plus Sesh's own tools; there is no eval, built-in LSP or OMP subagent. Every tool call appears in Sesh, Stop cancels a running turn, and nothing asks for approval. Autonomous sessions and resuming earlier sessions are not supported yet.

### Patch Changes

- f6be4a7: Keep Sesh child sessions on the parent’s registered Pico agent. Explicit harness overrides now fail before a child starts, and incompatible Sesh launch definitions fail visibly rather than exposing an unconstrained launch tool.
