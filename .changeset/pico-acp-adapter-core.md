---
"pico": minor
---

Add the Pico ACP adapter, a stdio agent that Sesh can launch as a custom agent; `mise run acp:launcher` writes it to `.build/pico-acp`. It runs Oh My Pi with your existing configuration and credentials, starting on your default model, and Sesh's Model and Thinking menus switch the model and thinking level for a session. Its tools are `read`, `grep`, `glob`, `edit`, `write`, `bash` and `web_search`, plus Sesh's own tools; there is no eval, built-in LSP or OMP subagent. Every tool call appears in Sesh, Stop cancels a running turn, and nothing asks for approval. Autonomous sessions and resuming earlier sessions are not supported yet.
