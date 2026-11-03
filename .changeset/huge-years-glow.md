---
"pico": minor
---

Give Pico its own settings. `pico settings update --default-model <provider/model>` saves the model and thinking level new Sesh sessions start on, in `~/Library/Application Support/Pico/settings.json`; a model chosen in Sesh still wins for its session, and reopened sessions keep their own. `pico` gains agent-first commands for this: `pico --help`, `pico cli search`, `pico schema`, `pico models list|get` and `pico settings get|update`, with JSON results, coded JSON errors, `--dry-run` and `--if-revision`.

Pico sessions no longer read your OMP configuration: not your OMP settings files or default model, not `models.yml`, not OMP extensions and hooks, and not the skills, rules, prompts and commands kept under `~/.omp` or a project's `.omp`. They use only your OMP credentials. `AGENTS.md`, `.agents` folders and local model servers such as Ollama and LM Studio still work. Until you save a default, new sessions start on OMP's own pick, and conversations whose model came from `models.yml` can no longer be reopened.
