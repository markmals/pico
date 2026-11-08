---
"pico": minor
---

Pico now finds your `intellisense` program even when Sesh starts it without your shell's `PATH`. With no location set, Pico searches its own `PATH` and then `~/.cargo/bin`, `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. You can set the location with `pico settings update --intellisense-path <path>`, or go back to searching with `auto`. Each session gives its agent the location to run, or the reason none can be used. `pico intellisense check` reports the location and runs it to show its version. In the Mac app, Tools & Integrations shows the location and the check result. From there you can choose a file, go back to automatic search, or check again. Settings files that store a location are version 3, and earlier versions of Pico report them as unsupported.
