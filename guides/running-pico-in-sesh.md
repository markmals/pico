---
id: guide.running-pico-in-sesh
title: Running Pico in Sesh
describes:
    [proposal.0001, proposal.0002, proposal.0003, proposal.0004, proposal.0006, proposal.0007]
---

# Running Pico in Sesh

## What it does

Pico is an ACP agent that Sesh launches as a custom agent. Each Sesh session gets an Oh My Pi (OMP) agent that uses your existing OMP credentials and Pico's own settings, with a fixed set of tools:

- **Files and commands:** `read`, `grep`, `glob`, `edit`, `write`, `bash` and `web_search`.
- **A task list:** `todo`, which Sesh shows as the session's plan (see [The task list](#the-task-list)).
- **Sesh's own tools,** when Sesh provides them: asking you questions, notifications, artifacts, session information and renaming, and starting and following other sessions. They appear as `mcp__sesh_ask_user`, `mcp__sesh_notify` and so on, titled like `sesh: ask_user`.

Every tool the agent runs appears in the Sesh conversation as its own tool call, with a title, its output, and whether it succeeded or failed. The one exception is a successful update to the task list, which appears only as the plan. Reads, writes and edits also show the files they work on, and a search shows the folder it searched when the agent named one. A successful edit or write shows a diff of each file it changed.

Pico never asks for approval. Tool calls do not wait for a permission decision; invalid requests can still fail validation before execution.

## How to use it

Pico runs on Apple silicon Macs with macOS 14 or later, and installs with Homebrew 6 or later.

1. Install Pico:

    ```sh
    brew install markmals/tap/pico
    ```

    This puts the `pico` executable at `/opt/homebrew/bin/pico`. `pico --version` prints the installed version, for example `pico 0.1.0`.

2. In Sesh, open **Settings › Machines**, select this Mac, click **Details…**, then **Add an Agent… › Custom…**. Name it "Pico" and choose `/opt/homebrew/bin/pico` as the executable.
3. Start a new session with that agent in a project, and send a prompt. The reply streams in, and each tool call appears as the agent runs it.
4. To choose a model for one session, use Sesh's **Model** menu for the agent. It lists every model Pico can use with your credentials (shown as `provider/model`), and the **Thinking** menu lists Off, Auto and the levels the chosen model supports. Your choice applies to that session only, survives reconnecting to it, and changes nothing in Pico's settings or your OMP configuration. You can change it mid-turn; the next request to the model uses it. From the command line, `sesh new --agent <id> --config model=<provider/model> --config thinking=<level> …` does the same when the session starts. To change the model new sessions start on, see [Choosing the default model](#choosing-the-default-model).
5. To stop the agent mid-turn, press Stop. A running command is killed, every unfinished tool call shows as failed, and you can send the next prompt straight away. The agent still remembers what happened in the stopped turn.

Sesh starts `pico` itself and talks to it over its standard input and output. Running `pico` with no arguments in a terminal prints its help and a reminder that Sesh launches it, then exits with status 2. `pico` also has commands of its own for Pico's settings and model list; see [The `pico` command](#the-pico-command).

### Choosing the default model

A new session starts on Pico's default model and thinking level. You set them once with `pico`, and every new Sesh session after that starts on them, without restarting anything:

1. See which models you can use, with the thinking levels each one offers:

    ```sh
    pico models list
    ```

2. Preview the change. `--dry-run` shows what the settings would become and writes nothing:

    ```sh
    pico settings update --default-model <provider/model> --dry-run
    ```

3. Make the change, then read it back:

    ```sh
    pico settings update --default-model <provider/model>
    pico settings get
    ```

Giving only `--default-model` keeps the thinking level you had saved when the new model offers it, and otherwise uses that model's own default level. `--default-thinking <level>` sets the level, for the model you name or for the saved one. A level the model doesn't offer is refused, and the error lists the levels it does offer.

What a session starts on:

- **With a default saved,** a new session starts on it. If that model has become unusable, for example because its credentials are gone, or the saved level is one the model no longer offers, the session fails to start with an error naming the model; Pico never starts on a different one. Choose another default with `pico settings update`.
- **With no default saved,** a new session starts on OMP's own pick: the first model it lists that you have credentials for, at that model's default thinking level. `pico settings get` names that model under `effective`. There is no command to remove a default once saved; deleting `settings.json` (see [Pico's own files](#picos-own-files)) is the only way back to OMP's pick.
- **A model you choose in Sesh** wins for that session. Sessions already open, and conversations you reopen, keep the model and thinking level they had, whatever the default is now.

If `settings.json` has been edited by hand and can't be read, or was written by a newer Pico, new sessions fail to start with the file's path and the problem, and `pico settings update` refuses to change it until you fix or delete it. Reopening an existing conversation still works.

### What Pico reads from OMP

Pico uses OMP as its engine, with OMP's built-in defaults and Pico's own settings. From your OMP setup, it uses only your credentials. It does not read:

- your OMP settings, global (`~/.omp/agent/config.yml`) or per project, including OMP's default model;
- custom models and providers in `~/.omp/agent/models.yml`;
- OMP extensions and hooks, in `~/.omp/agent/extensions` or a project's `.omp/extensions`;
- skills, rules, prompts, commands, system prompt files and `AGENTS.md` kept in `~/.omp/agent` or a project's `.omp` folder, or OMP's auto-learned skills.

`AGENTS.md` files in your projects and folders, `.agents` and `.agent` folders, and other agents' folders such as `.claude` still load, as in any session. Local model servers that OMP finds on its own, such as Ollama, llama.cpp and LM Studio, still work, including when you point OMP at them with `OLLAMA_BASE_URL`, `LLAMA_CPP_BASE_URL` or `LM_STUDIO_BASE_URL`. Terminal OMP is unaffected: it keeps using all of your OMP configuration.

### The `pico` command

Besides running as Sesh's agent, `pico` answers commands about its settings and the models it can use. They are built to be found and used without this guide, by you or by an agent:

- `pico --help` lists every command and how to explore them.
- `pico <command> --help` explains one command, with examples, for example `pico settings update --help`.
- `pico cli search "<what you want to do>"` suggests commands, for example `pico cli search "change the default model"`.
- `pico schema <command>` describes a command's options, output and errors as JSON, for scripts and agents.
- `pico models list` and `pico models get <provider/model>` show the models you can use and their thinking levels.
- `pico settings get` shows Pico's settings, whether the file is valid, and what new sessions start on.
- `pico settings update` changes the default model or thinking level.

Apart from `--help` and `--version`, every command prints one JSON document on standard output. A failure prints nothing there; instead, the last line of standard error is a JSON error with a `code` (such as `INVALID_ARGUMENT` or `NOT_FOUND`), a `message`, whether retrying could help, and details, and the command exits with status 2 for a mistake in the command itself or 1 for anything else. No command asks a question or waits for input.

`pico settings update` also accepts `--if-revision <revision>`: it then refuses, with `CONFLICT`, to change a settings file that has changed since you read its `revision` from `pico settings get`. Every change returns a receipt with the settings before and after, and making the same change twice changes nothing the second time.

### The task list

For work with several steps, the agent keeps a task list with OMP's `todo` tool. Sesh shows it as the session's plan, in the **Plan** panel pinned above the message box, with a count such as "Plan · 1 of 3" of the items completed:

- The plan is one flat list, in the agent's order. The agent is asked to keep a single list; if it groups items into phases anyway, the phase names don't appear.
- Each item is completed, in progress or pending. An item the agent drops leaves the plan, and the count shrinks. An item the agent marks blocked shows as pending, with "(blocked: …)" and its reason, or "(blocked)" when it gave none.
- When the agent clears the list, the panel disappears.
- A successful update to the list adds nothing to the conversation; only the plan changes. An update that fails, for example one that names an item not on the list, appears in the conversation as a failed tool call titled with what the agent was doing (or "Update plan"), carrying the error, and the plan stays as it was. An update the agent was making when you pressed Stop shows as failed too, and when the turn ends the plan shows the list as the agent kept it.
- When you reopen a conversation, the plan shows the agent's current list, even if the adapter stopped part-way through a turn.

Pico always offers the task list, even if your OMP configuration turns `todo` off, and it never sends OMP's todo reminders: when the agent stops with items still open, the turn ends there. Making a list also starts no background requests to rename the conversation, which OMP would otherwise send to a model. Your OMP configuration is not changed.

### Reopening a conversation

When Sesh reconnects to an existing Pico session after the adapter stops, Pico restores the agent's saved context instead of starting another conversation. Sesh still owns the conversation UI and workspace; Pico's saved state lets the agent remember earlier messages, tool results and its session-local model and thinking choices. Starting a new Sesh session creates a different agent conversation, even in the same project.

The project must still exist at the same directory. A moved or removed worktree, unavailable saved model, unusable credentials, damaged history, or another process already using that agent session produces an error rather than a new empty conversation or a substituted model. Pico never imports your terminal OMP sessions.

An ACP client can resume without receiving old messages, or load the full saved conversation when it needs history replay. Loading includes messages retained before compaction, one card per tool invocation, and the saved final results and captured diffs rather than a reconstruction from today's files. Successful task-list updates have no card, as when they happened, and no earlier plan is replayed. A tool interrupted by the previous process is shown as failed with an unknown outcome when its result was not recorded; loading never runs it again or promises that its side effects were undone. Transient output that was not committed before a crash may be missing, and a missing saved diff says so.

Both loading and resuming end by sending the conversation's current plan once, even when it has no items. Resuming sends nothing else.

An ACP client can also load or resume an idle session again on the same connection, keeping its identifier and saved choices. Each explicit load returns one full replay; resume returns none. A request made while a turn, model/thinking change or another reattachment is in progress is refused as busy without interrupting that work. Invalid working-directory or MCP transport parameters leave the existing attachment alone; another connection or process cannot take over a live attachment.

Only the MCP servers supplied by the reconnecting client are connected. An absent server from an earlier turn remains visible in history but is not available for new calls. Saving a conversation does not save MCP server commands, connection credentials or tokens for later reconnection.

Pico confirms a turn or a setting change only after its state has been saved. If saving fails, the operation reports the cause and that attachment cannot accept more prompts; reopen it after correcting the storage problem. Conversations created by older, in-memory-only Pico versions have no saved state to restore.

Other ACP clients can use `session/list` to discover Pico's saved conversations, optionally filtered by directory, in pages of up to 50. That list is private to Pico's storage; it is not a second history browser or a list of your terminal OMP sessions.

### Upgrading and uninstalling

- `brew upgrade pico` installs the new version. New Sesh sessions use it straight away, through the same `/opt/homebrew/bin/pico` path, so the agent entry in Sesh needs no change. Sessions already running keep the version they started with until they end.
- `brew uninstall pico` removes the executable. Pico's own files stay in `~/Library/Application Support/Pico` until you delete that folder. Remove the agent in Sesh's machine settings too.

### Pico's own files

Pico keeps the files it creates in `~/Library/Application Support/Pico`, which it creates with access for your user only:

- `natives/<version>/`: OMP's native addon, which `pico` carries inside itself and writes out here the first time it needs it. Pico checks the file against its own copy every time it starts and rewrites it if it differs. It removes another version's folder once nothing has used it for 10 minutes, and leaves OMP's other folders here, such as `grammars/`, alone.
- `settings.json`: Pico's settings, written only by `pico settings update`. It doesn't exist until you first save a default.
- `models.db`: the cache of OMP's model list.
- `sessions/`: the private OMP-format journals for Pico's agent conversations and their artifacts, grouped by working directory.
- `engine/`: SDK supporting history state, including saved blobs and any title index. This is separate from the original OMP configuration and credential store.

If Pico can't create or write that folder, or can't write `models.db` and the log files SQLite keeps beside it, `pico` stops before Sesh can talk to it, Sesh shows that the agent failed to start, and the error reads `pico: cannot use <path>: <reason>`.

### Running Pico from a checkout

For work on Pico itself, run it from the repository instead:

1. In the Pico checkout, build the launcher:

    ```sh
    mise run acp:launcher
    ```

    It writes an executable at `.build/pico-acp` that runs Pico with the Bun this repository pins. If that Bun isn't installed, or its path contains a space, the command fails and says why; run `mise install` and try again.

2. Register `.build/pico-acp` in Sesh as a custom agent, for example "Pico (dev)", the same way as above.

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

To see the task list, send:

> Use the todo tool to make a task list with three items: Draft, Review, Publish. Then mark Draft done and stop.

The Plan panel appears above the message box showing "Plan · 1 of 3": Draft completed, Review in progress, Publish pending. The conversation shows the agent's text but no `todo` tool calls. Ask the agent to mark an item named "Translate" done, and a failed tool call appears saying that task was not found, while the plan stays the same. Ask it to clear the task list, and the panel disappears.

## Delegating reviews and other work

Start the parent session with your registered Pico agent. Pico is instructed to use Sesh’s `start_session` tool for reviews and other delegation when Sesh supplies it. The child appears under the parent in Sesh and uses the same registered Pico agent, with Pico’s curated tools and approval-free policy. Your registration does not have to be named `pico`.

The child-session tool has no agent selector. Supplying an `agent` field anyway makes that call fail before Sesh receives a launch request, even if the field is empty, null, or names the parent’s own agent. Omit the field instead. Pico never silently changes an explicitly requested harness or retries the launch with another one.

This rule selects the harness, not the provider or model. A Codex model available inside Pico is still usable; a Codex harness is not an alternative child-session backend. Child model and thinking settings follow the options Pico and Sesh actually offer; this rule does not copy the parent’s model selection to its children.

Sesh still owns worktrees, launch limits, reporting, and stopping children. A failed launch remains a failed tool call with its cause. If Sesh does not provide child-session tools, Pico can continue its other work but cannot delegate. If Sesh provides an incompatible child-launch definition, Pico refuses to start the session and names `sesh/start_session` in the error rather than exposing an unprotected launch operation. A host definition that requires an explicit agent cannot support inherited-agent launches and is rejected at startup.

Pico’s instructions prohibit native workers and shell-launched harnesses as delegation fallbacks. Normal shell access remains available: this tool-level restriction is not an operating-system sandbox against arbitrary commands or scripts. Sessions running stock OMP or another registered agent do not acquire Pico’s policy; select Pico when starting the parent.

## What the agent can't do

- **No Python or JavaScript eval** and **no built-in language server.** For code intelligence, the agent runs your `intellisense` CLI through `bash`, like any other command. Edits get no automatic diagnostics or formatting.
- **No OMP subagents** (`task`, or OMP's worker sessions). To split work up, the agent starts real Sesh sessions with Sesh's own tools. If it tries a tool it doesn't have, that tool call shows as failed and nothing runs.
- **Not available yet:** OMP's `ask`, `find`, `wait`, `ast_grep`, `ast_edit`, `checkpoint`, `rewind`, `debug` and its memory tools. OMP extensions don't load in Pico at all, so neither their tools nor their hooks run (see [What Pico reads from OMP](#what-pico-reads-from-omp)).
- **Questions to you** go through Sesh's `ask_user` tool, so you can answer them from your phone.

## Limits and edge cases

- **Model:** a new session starts on Pico's default model and thinking level, or on OMP's pick when no default is saved (see [Choosing the default model](#choosing-the-default-model)), and you can switch both from Sesh's menus. Reopening uses that conversation's saved choices instead of replacing them with a changed default. A session fails to start or restore, with an error saying why, when its model isn't available (Pico never starts on another model instead), or its credentials can't be used. A conversation whose model came from your `models.yml` can no longer be reopened, because Pico no longer reads that file. Choosing a model from the menu whose credentials can't be used is refused with the reason, and the session stays on its current model. Switching to a model that can't reason sets Thinking to Off.
- **Provider errors during a turn** (an expired key, a rate limit, a network failure) end the turn with an error that carries the provider's message, not with a normal reply. What the agent had already shown stays in the conversation.
- **Credentials:** Pico uses your OMP credential store at `~/.omp/agent/agent.db`. If an OAuth token has expired, OMP refreshes it there when the session starts or later, exactly as terminal OMP does. Pico never copies or deletes credentials.
- **What Pico still writes in `~/.omp`:** OMP keeps these files there, and Pico has no way to move them:
    - your credential store, `~/.omp/agent/agent.db` (created if you have none yet), for OAuth refresh;
    - its logs, in `~/.omp/logs`;
    - the SDK's runtime ownership locks, in `~/.omp/run/session-owners`; these are not conversation archives.

    Everything else Pico creates is in `~/Library/Application Support/Pico`.

- **macOS's own `pico` editor:** macOS ships a text editor at `/usr/bin/pico`. With Homebrew first on your `PATH`, typing `pico` in a terminal runs Pico instead. `nano`, or `/usr/bin/pico` by its full path, still opens the editor.
- **Project files:** the session's working directory decides which `AGENTS.md` files and `.agents` folders the agent uses. A project's `.omp` folder is ignored.
- **New Branch sessions** (Sesh's default) work normally. The working directory is the session's worktree, so the agent works and reads project files there, and you push and open pull requests from Sesh.
- **Autonomous sessions don't work yet.** Sesh's sandbox blocks writes to `~/.omp`, so OMP can't open your credential store. The session fails to start with an error that names `agent.db` and says Autonomous sessions aren't supported yet.
- **MCP servers:** only the servers Sesh provides, running in the session's working directory. Servers in your own OMP MCP configuration are not connected. The session fails to start, with an error naming the server and the reason, if one of Sesh's servers can't start, hasn't listed its tools within 30 seconds, isn't a local (stdio) server, shares its name with another, or offers two tools whose names OMP can't tell apart. You never get a session with only some of the servers or tools.
- **Diffs:** a successful edit or write shows a diff for every file it changed, including deleted ones, with exactly what the file held before. A failed edit or write shows its error instead. For a file Pico can't read, a binary file, or a file larger than 1 MiB, the tool call names the file and says why there is no diff; the same goes for the destination of a moved file, because OMP doesn't report what it replaced (the moved-from file shows as removed). A write to one of OMP's scratch locations (such as `local://notes.md`) is not a project file and shows the tool's text instead of a diff. Overwriting a file with Windows line endings or a byte order mark keeps them, as terminal OMP does.
- **Turning Sesh's tools off** (**Sesh Tools for Agents** in the machine's details) leaves the agent without them; Pico doesn't replace them.
- **Prompts:** text, in the order you send it, and links to files, which the agent receives as a named reference rather than the file's contents. Images, audio and embedded file contents are rejected with an error naming the unsupported type.
- **One turn at a time:** a prompt sent while a turn is still running is rejected with an error; the running turn continues.
- **History after restart:** Pico restores saved agent context when the client reconnects to the same identifier. Sessions created before Pico had persistence cannot be recovered. See [Reopening a conversation](#reopening-a-conversation) for restoration errors and interrupted tools.
- **A stuck cancellation:** if pressing Stop can't stop the agent, the turn ends as cancelled within at most 10 seconds and that session is closed. Later prompts in it fail with an error saying so; start a new session.
- **Removing Pico:** run `brew uninstall pico`, delete `~/Library/Application Support/Pico` if you also want to delete its saved conversations and supporting files, and remove the agent in Sesh's machine settings. A checkout install is removed by deleting `.build/`. This does not delete OMP's own history or credentials, undo changes made in your projects, or remove Sesh's own displayed history.
