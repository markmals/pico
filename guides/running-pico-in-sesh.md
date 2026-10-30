---
id: guide.running-pico-in-sesh
title: Running Pico in Sesh
describes: [proposal.0001]
---

# Running Pico in Sesh

## What it does

Pico is an ACP agent that Sesh launches as a custom agent. Each Sesh session gets an Oh My Pi (OMP) agent that uses your existing OMP configuration, credentials and default model, with a fixed set of tools:

- **Files and commands:** `read`, `grep`, `glob`, `edit`, `write`, `bash` and `web_search`.
- **Sesh's own tools,** when Sesh provides them: asking you questions, notifications, artifacts, session information and renaming, and starting and following other sessions. They appear as `mcp__sesh_ask_user`, `mcp__sesh_notify` and so on.

Every tool the agent runs appears in the Sesh conversation as its own tool call, with its title, the files it touched, its output, and whether it succeeded or failed. Edits and writes show a diff.

Pico never asks for approval. Every tool call runs as soon as the agent makes it.

## How to use it

1. In the Pico checkout, build the launcher:

    ```sh
    mise run acp:launcher
    ```

    It writes an executable at `.build/pico-acp`.

2. In Sesh, open **Settings › Machines**, select this Mac, click **Details…**, then **Add an Agent… › Custom…**. Give it a name such as "Pico (dev)" and choose `.build/pico-acp` as the executable.
3. Start a new session with that agent in a project, and send a prompt. The reply streams in, and each tool call appears as the agent runs it.
4. To stop the agent mid-turn, press Stop. A running command is killed, every unfinished tool call shows as failed, and you can send the next prompt straight away. The agent still remembers the stopped turn.

The launcher runs Pico from this checkout with the repository's pinned Bun, so it works however Sesh launches it. If you move or delete the checkout, or remove `.build/`, rebuild the launcher and update the agent in Sesh.

## Worked example

Ask in a session: "Create `hello.txt` containing `hi`, then show it with cat."

The conversation shows:

- the agent's text as it streams;
- a `write` tool call for `hello.txt`, completed, with a diff that has no old text and `hi` as the new text;
- a `bash` tool call titled `cat hello.txt`, completed, with `hi` as its output.

Ask it to run `exit 3`, and the `bash` tool call shows as failed, with the command's output and exit code.

## What the agent can't do

- **No Python or JavaScript eval** and **no built-in language server.** For code intelligence, the agent runs your `intellisense` CLI through `bash`, like any other command.
- **No OMP subagents** (`task`, or OMP's worker sessions). To split work up, the agent starts real Sesh sessions with Sesh's own tools.
- **Not available yet:** OMP's `ask`, `todo`, `find`, `wait`, `ast_grep`, `ast_edit`, `checkpoint`, `rewind`, `debug`, its memory tools, and tools added by OMP extensions. Your extensions' hooks still run.
- **Questions to you** go through Sesh's `ask_user` tool, so you can answer them from your phone.

## Limits and edge cases

- **Model:** Pico uses the model and thinking level your OMP configuration selects for the project. There is no model picker in Sesh yet. If no model is configured, or its credentials are missing, the session fails to start with an error saying so.
- **Credentials:** Pico uses your OMP credential store at `~/.omp/agent/agent.db`. If an OAuth token has expired, OMP refreshes it there, exactly as terminal OMP does. Pico never copies or deletes credentials.
- **New Branch sessions** (Sesh's default) work normally. The agent works in the session's worktree, and you push and open pull requests from Sesh.
- **Autonomous sessions don't work yet.** Sesh's sandbox blocks writes to `~/.omp`, so OMP can't open your credential store. The session fails to start with an error that names `agent.db` and says Autonomous sessions aren't supported yet.
- **MCP servers:** only the servers Sesh provides. Servers in your own OMP MCP configuration are not connected. If one of Sesh's servers can't start, the session fails to start with an error naming that server.
- **Turning Sesh's tools off** (**Sesh Tools for Agents** in the machine's details) leaves the agent without them; Pico doesn't replace them.
- **Prompts:** text and links to files. Images, audio and embedded file contents are rejected with an error naming the unsupported type.
- **One turn at a time:** a prompt sent while a turn is still running is rejected with an error; the running turn continues.
- **No history after restart:** if Sesh restarts the agent, earlier conversations can't be resumed in Pico yet.
- **A stuck cancellation:** if the agent can't stop within 5 seconds of pressing Stop, the turn ends as cancelled and that session is closed. Later prompts in it fail with an error saying so; start a new session.
- **Removing Pico:** remove the agent in Sesh's machine settings and delete `.build/`. Nothing else on your Mac was changed.
