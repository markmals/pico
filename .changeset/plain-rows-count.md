---
"pico": minor
---

Add `pico version get`, which reports the installed `pico` version and the version of the Oh My Pi engine it carries. The Mac app's General › Versions and Diagnostics & About › About now show the app's own version and the `pico` and OMP versions read from the resolved command, re-read with each runtime check; a command that can't report them shows Couldn’t read with its cause. The app bundle now carries its release version instead of Tuist's default 1.0.
