---
"pico": minor
---

Ship Pico as `pico`, a single executable you install with `brew install markmals/tap/pico` on an Apple silicon Mac running macOS 14 or later, and register in Sesh as `/opt/homebrew/bin/pico`. `pico --version` prints its version; running it at a terminal prints its usage instead of waiting for Sesh. Pico now keeps the files it creates, OMP's native addon and the model cache, in `~/Library/Application Support/Pico` instead of `~/.omp`. The repository is MIT licensed, and `THIRD-PARTY-NOTICES.md` lists everything `pico` bundles.
