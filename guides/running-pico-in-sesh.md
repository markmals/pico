---
id: guide.running-pico-in-sesh
title: Running Pico in Sesh
describes: [proposal.0001]
---

# Running Pico in Sesh

## What it does

Pico is an ACP agent that Sesh launches as a custom agent. Each Sesh session gets an Oh My Pi (OMP) agent that uses your existing OMP configuration, credentials and default model, with a fixed set of tools:

- **Files and commands:** `read`, `grep`, `glob`, `edit`, `write`, `bash` and `web_search`.
- **Sesh's own tools,** when Sesh provides them: asking you questions, notifications, artifacts, session information and renaming, and starting and following other sessions. They appear as `mcp__sesh_ask_user`, `mcp__sesh_notify` and so on, titled like `sesh: ask_user`.

Every tool the agent runs appears in the Sesh conversation as its own tool call, with a title, its output, and whether it succeeded or failed. Reads, writes and edits also show the files they work on, and a search shows the folder it searched when the agent named one. A successful edit or write shows a diff of each file it changed.

Pico never asks for approval. Every tool call runs as soon as the agent makes it.

## How to use it

1. In the Pico checkout, build the launcher:

    ```sh
    mise run acp:launcher
    ```

    It writes an executable at `.build/pico-acp` that runs Pico with the Bun this repository pins. If that Bun isn't installed, or its path contains a space, the command fails and says why; run `mise install` and try again.

2. In Sesh, open **Settings › Machines**, select this Mac, click **Details…**, then **Add an Agent… › Custom…**. Give it a name such as "Pico (dev)" and choose `.build/pico-acp` as the executable.
3. Start a new session with that agent in a project, and send a prompt. The reply streams in, and each tool call appears as the agent runs it.
4. To stop the agent mid-turn, press Stop. A running command is killed, every unfinished tool call shows as failed, and you can send the next prompt straight away. The agent still remembers what happened in the stopped turn.

The launcher points at this checkout. If you move or delete the checkout, run `mise run acp:launcher` again in its new location and update the agent's executable in Sesh.

## Worked example

Send this prompt in a session:

> Do exactly these three steps, in this order, and nothing else. 1. Use the write tool to create a file named pico-smoke.txt in the current working directory, containing exactly one line: hello from pico 2. Use the read tool to read pico-smoke.txt back. 3. Use the bash tool to run exactly this command, once: cat pico-smoke.txt

The conversation shows:

- the agent's text as it streams;
- a `write` tool call for `pico-smoke.txt`, completed, with a diff that has no old text and `hello from pico` as the new text;
- a `read` tool call for `pico-smoke.txt`, completed;
- a `bash` tool call titled `cat pico-smoke.txt`, completed, with `hello from pico` as its output.

Then ask it to run `exit 3` with the bash tool: that tool call shows as failed, with the message `Command exited with code 3`.

## What the agent can't do

- **No Python or JavaScript eval** and **no built-in language server.** For code intelligence, the agent runs your `intellisense` CLI through `bash`, like any other command. Edits get no automatic diagnostics or formatting.
- **No OMP subagents** (`task`, or OMP's worker sessions). To split work up, the agent starts real Sesh sessions with Sesh's own tools. If it tries a tool it doesn't have, that tool call shows as failed and nothing runs.
- **Not available yet:** OMP's `ask`, `todo`, `find`, `wait`, `ast_grep`, `ast_edit`, `checkpoint`, `rewind`, `debug`, its memory tools, and tools added by OMP extensions. Your extensions' hooks still run; an extension that fails to load is skipped, and the session starts without it.
- **Questions to you** go through Sesh's `ask_user` tool, so you can answer them from your phone.

## Limits and edge cases

- **Model:** Pico uses the model and thinking level your OMP configuration selects for the project. There is no model picker in Sesh yet. The session fails to start with an error saying why when no model is configured, when the configured model isn't available (Pico never switches to another one), or when its credentials can't be used.
- **Provider errors during a turn** (an expired key, a rate limit, a network failure) end the turn with an error that carries the provider's message, not with a normal reply. What the agent had already shown stays in the conversation.
- **Credentials:** Pico uses your OMP credential store at `~/.omp/agent/agent.db`. If an OAuth token has expired, OMP refreshes it there when the session starts or later, exactly as terminal OMP does. Pico never copies or deletes credentials.
- **Project files:** the session's working directory decides which project settings, extensions and `AGENTS.md` files OMP uses, exactly as in terminal OMP.
- **New Branch sessions** (Sesh's default) work normally. The working directory is the session's worktree, so the agent works and reads project files there, and you push and open pull requests from Sesh.
- **Autonomous sessions don't work yet.** Sesh's sandbox blocks writes to `~/.omp`, so OMP can't open your credential store. The session fails to start with an error that names `agent.db` and says Autonomous sessions aren't supported yet.
- **MCP servers:** only the servers Sesh provides, running in the session's working directory. Servers in your own OMP MCP configuration are not connected. The session fails to start, with an error naming the server and the reason, if one of Sesh's servers can't start, hasn't listed its tools within 30 seconds, isn't a local (stdio) server, shares its name with another, or offers two tools whose names OMP can't tell apart. You never get a session with only some of the servers or tools.
- **Diffs:** a successful edit or write shows a diff for every file it changed, including deleted ones. A failed edit or write shows its error instead. For a file Pico can't read, a binary file, or a file larger than 1 MiB, the tool call names the file and says why there is no diff. A write to one of OMP's scratch locations (such as `local://notes.md`) is not a project file and shows the tool's text instead of a diff. When the agent changes a file with a command and then edits or writes it in the same step, the diff's old text can show the file as it was before that step.
- **Turning Sesh's tools off** (**Sesh Tools for Agents** in the machine's details) leaves the agent without them; Pico doesn't replace them.
- **Prompts:** text, in the order you send it, and links to files, which the agent receives as a named reference rather than the file's contents. Images, audio and embedded file contents are rejected with an error naming the unsupported type.
- **One turn at a time:** a prompt sent while a turn is still running is rejected with an error; the running turn continues.
- **No history after restart:** if Sesh restarts the agent, earlier conversations can't be resumed in Pico yet.
- **A stuck cancellation:** if pressing Stop can't stop the agent, the turn ends as cancelled within at most 10 seconds and that session is closed. Later prompts in it fail with an error saying so; start a new session.
- **Removing Pico:** remove the agent in Sesh's machine settings and delete `.build/`. Pico itself stores no history and never rewrites your OMP configuration; only what the agent did in your projects, and any OAuth refresh in `agent.db`, remain.
