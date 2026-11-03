---
"pico": minor
---

Show background commands in Sesh. When the agent runs `bash` with `async`, or a plain command is still running after 60 seconds, the command stays one tool call that streams its output, names its job ("Running in the background as job bg_1.") and ends with the command's outcome. A background command belongs to its turn: Sesh shows the turn as running until every job ends, the agent's follow-up after a job finishes appears in that same turn, and pressing Stop or disconnecting kills every job and everything it started, including programs that ignore SIGTERM. The agent can block on its jobs with OMP's `wait` tool, shown as "Wait for background jobs" with one line per job.

Before this, a backgrounded command showed as completed with OMP's internal notice, its output never reached Sesh, and the run that followed when it finished was invisible and could not be stopped.

`pico settings update --auto-background off` keeps slow commands in the foreground (`on` restores the default); `pico settings get` reports it as `autoBackground`. Every session you start or reopen reads it. OMP's service mode (`bash` with `name` and `ready`), which Pico offered unintentionally, is gone.
