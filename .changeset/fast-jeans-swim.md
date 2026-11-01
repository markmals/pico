---
"pico": minor
---

Continue Pico conversations after the adapter restarts. Pico saves private agent context under `~/Library/Application Support/Pico`, separate from terminal OMP history. ACP clients can resume without replay, load the saved conversation with final tool results and captured diffs, or list Pico's sessions. Model and thinking choices survive reopening without changing OMP defaults; conversations created by older, in-memory-only versions cannot be recovered.
