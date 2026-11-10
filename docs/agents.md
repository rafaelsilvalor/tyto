# Coding agents on Tyto

Tyto is worked on by two coding agents, Claude Code and OpenAI Codex, under the same rules.
This page says where each one reads those rules, what each tool has that the other lacks, and
how the two talk to each other.

## One set of rules, two readers

`AGENTS.md` at the repository root is the single source of the project's rules. Codex reads it
natively. `CLAUDE.md` imports it with `@AGENTS.md`, so Claude Code reads the same text, and adds
only what is specific to Claude Code. A rule is changed in `AGENTS.md`, never in both.

Each person's own rules (language, reporting style, machine paths, account permissions) live
outside the repository, in the agent's home folder: `~/.claude/CLAUDE.md` for Claude Code,
`~/.codex/AGENTS.md` for Codex. The repository is public, so nothing personal or private goes
into it, and a rule that names a private path names it as a placeholder whose value the home
file gives.

Codex concatenates the home file and every `AGENTS.md` from the repository root down to the
working directory, and stops adding at `project_doc_max_bytes` (32 KiB by default). Keep the
root file well under that: the home file shares the budget.

## Commands and skills

| Claude Code                                           | Codex                                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `.claude/commands/<name>.md`, run as `/<name> <args>` | `.agents/skills/<name>/SKILL.md`, run as `$<name> <args>` or picked from `/skills` |
| `~/.claude/skills/<name>/SKILL.md` (personal)         | `~/.agents/skills/<name>/SKILL.md` (personal)                                      |

Every repository command in `.claude/commands/` has a Codex port in `.agents/skills/`; the two
folders are the list. **Each port names its source, and a rule changed in one is changed in the
other in the same PR.** `tools/repo-checks/src/codex-ports.test.ts` fails on a command without
a port, a port without a command (such as a `source-command-<name>` folder the Codex app wrote
on its own), a port whose frontmatter lacks its `name` or `description`, and a port that does
not name its source file. It compares each pair's skeleton, the ordered `##` and `###` headings
and numbered steps with their bold labels, and names the first step that differs; a difference
the two tools need is listed, with its reason, in `ALLOWED_PORT_DIFFERENCES` in that file. It
also checks the list of command names in `CLAUDE.md` against `.claude/commands/`, both ways. The two formats differ only in the frontmatter (a skill needs `name` and
`description`) and in the tools the text names.

**A repository command calls scripts in `tools/repo-checks/src/`, never multi-line shell.**
Neither a command nor its port carries a shell loop, a multi-line pipeline or a script for the
agent to write: what needs one is a script in `tools/repo-checks/src`, with tests and arguments
instead of edited constants, and the command calls it in one line (`adr-numbers.mjs`,
`flake-hunt.mjs`, `perturb-cycle.mjs`; TYTO-629). `tools/repo-checks/src/command-shell.test.ts`
fails on a fenced block holding a `for`/`while` loop, a pipeline split across lines or a
trailing `\`, naming the file and line. It has no allowlist.

## What each tool has

| Claude Code                                          | Codex equivalent                                                         | Status        |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ------------- |
| `CLAUDE.md` (repository)                             | `AGENTS.md` (repository)                                                 | migrated      |
| `~/.claude/CLAUDE.md`                                | `~/.codex/AGENTS.md`                                                     | migrated      |
| Repository slash commands                            | Repository skills in `.agents/skills/`                                   | adapted       |
| Personal skills                                      | Personal skills in `~/.agents/skills/`                                   | migrated      |
| Auto memory (a folder the agent writes as it learns) | Rules copied into the home `AGENTS.md`; nothing is written automatically | adapted       |
| Asking the person with option buttons                | A question in chat, one per message                                      | adapted       |
| Starting an executor session (`start_session`)       | `git worktree add` + `codex exec -C <worktree>`                          | adapted       |
| Messaging a session (`SendMessage`)                  | `codex exec resume <thread id> "<message>"`; `codex queue --thread`      | adapted       |
| Reading a session's events                           | The last message of each turn (`codex exec -o <file>`)                   | adapted       |
| Subagents (`Agent`)                                  | Codex's own sub-agents (`multi_agent` feature)                           | adapted       |
| Showing a file or image to the person                | The file's full path in chat                                             | adapted       |
| Running a dev server in the browser pane             | A long-running shell process, plus Codex's browser plugin                | adapted       |
| Background commands that notify when done            | A blocking command (`gh pr checks --watch`)                              | adapted       |
| Jira through the Atlassian connector                 | The Atlassian MCP server added with `codex mcp add`                      | setup needed  |
| Multi-agent workflow scripts                         | None                                                                     | no equivalent |
| Published HTML artifacts                             | None                                                                     | no equivalent |
| The app's PR monitor and CI auto-fix                 | None; the agent reads `gh pr checks` itself                              | no equivalent |
| Scheduled and recurring tasks                        | None                                                                     | no equivalent |

## How the two talk to each other

Neither tool can open the other's sessions directly. Four channels exist, from most to least
direct.

1. **Claude Code drives Codex** through the Codex CLI. `codex exec` starts a thread and prints
   its `thread_id` as the first JSON line; `codex exec resume <thread_id> "<message>"`
   continues the same conversation, and `-o <file>` writes the reply. Measured on 2026-10-31:
   a thread answered, and the resumed thread remembered its earlier reply.
2. **Codex drives Claude Code** through the Claude Code CLI. `claude -p --session-id <uuid>
"<prompt>"` starts a session with a known id, and `claude -p --resume <uuid> "<message>"`
   continues it. Not measured yet. A session of the Claude desktop app cannot be reached from
   outside it: there is no command that messages it.
3. **Shared files.** The private batch repository that coordinators share is plain Markdown in
   git. Any agent can pull it, append a dated line to a batch file, and push; the other reads it
   on its next pull. This is the only channel into a Claude desktop session, and it needs the
   person to tell that session to read it.
4. **The repository itself.** Branches, PRs, PR comments and Jira cards are visible to both, and
   are where finished work is handed over.

A coordinator of either tool records each executor's address in the batch file: a Claude Code
agent id (an internal executor, resumed with `SendMessage`) or session id, or
`codex:<thread id>`. That is how the next coordinator, of either tool, finds them. Executors of
both tools follow the same rules, `docs/executor-protocol.md`.

## Looking at the running app

An agent can inspect the maintainer's running Tyto instead of asking for screenshots: the window,
its text, its tabs, its plugins and a recipe's plan (TYTO-651, ADR 0178). It reaches the window
and its bridge, never main.

**Turn it on** by starting Tyto with Chromium's debugging switch, before the app folder:

```
electron.exe --remote-debugging-port=9333 .
```

The status bar then reads "Verification mode · port 9333" in red, and no setting hides it. The
port listens on `127.0.0.1` only (measured in ADR 0178), but **while it is on, any program on the
machine can read and drive the window**; restart Tyto without the switch to turn it off. There is
no environment variable for it, on purpose: plugins and the integrated terminal inherit the
environment.

The maintainer's launcher (`abrir-tyto.ps1`) lives outside the repository. The change it needs
is one parameter and one line, so a second shortcut runs `abrir-tyto.ps1 -Verificar`:

```powershell
param([switch]$Verificar)   # first line of the script
# in Open-Tyto, instead of -ArgumentList '.':
Start-Process -FilePath $Electron -ArgumentList (@(if ($Verificar) { '--remote-debugging-port=9333' }) + '.') -WorkingDirectory (Join-Path $App 'apps\desktop')
```

**Use it** from `apps/desktop`. Each command connects, prints plain text or a PNG path, and
disconnects; the person's app keeps running.

| Command                                   | What it prints                                                  |
| ----------------------------------------- | --------------------------------------------------------------- |
| `node scripts/verify.ts screenshot`       | The path of a PNG of the window                                 |
| `node scripts/verify.ts text`             | The window's visible text                                       |
| `node scripts/verify.ts tabs`             | The open tabs, the one in front of each group marked `*`        |
| `node scripts/verify.ts plugins`          | Each plugin, and its credentials as set / not set, never values |
| `node scripts/verify.ts recipe [--fresh]` | Runs the recipe in front, then each cell's status and plan      |

`--port <n>` names another port (9333 by default). Every command but `recipe` only reads.
`recipe` is the person's Run (`recipe.run`, or `recipe.runFresh` with `--fresh`): it fetches its
sources, it prints the command before running it, and a recipe whose header says `apply auto`
(ADR 0170) applies its plan, writing to the services it names, as the person's Run does. Ask the
maintainer before running it on a real workspace. With the mode off, every command fails with
`connect ECONNREFUSED 127.0.0.1:9333`.

## Tyto as an MCP server

`tyto mcp [folder]` serves a folder's templates and briefs to an agent over the Model Context
Protocol on stdio (TYTO-565, ADR 0179). The agent's host starts it and talks to it; nobody runs it
by hand. It offers four reads to any folder, and three writes to a trusted one:

| Tool                | What it answers                                                       |
| ------------------- | --------------------------------------------------------------------- |
| `list_templates`    | Every template a brief in the folder can name                         |
| `describe_template` | A template's formats and sizes, its slots, and a new brief's skeleton |
| `check_brief`       | A brief's diagnostics with line and column; structure only, no fetch  |
| `render_preview`    | One format as PNG, at most 1,024 px on its longest side, 4 artworks   |
| `write_brief`       | Creates or replaces one `.brief`; `dry_run` shows the diff and hash   |
| `new_delivery`      | `tyto delivery new`: the folder, its layout's folders and the brief   |
| `export`            | Renders to a preset's folder, the delivery's or the workspace output  |

A brief is named by a path inside the folder (or its workspace) or handed over as text. The reads
write nothing. In a folder nobody trusted, the folder's plugin files are not loaded, as on
`tyto render`, and the write tools are not offered (ADR 0179 decision 3). The writes follow ADR
0185: only `.brief` files, a replacement needs the SHA-256 a dry run answered, an export goes
only where the workspace says, and a brief in a folder a live window has open is not replaced
(propose it through `--window` instead).

It also serves what each template's folder says about writing a brief for it (ADR 0186): the
resources `tyto://template/<name>/guide` (its `guide.md`) and `tyto://template/<name>/examples/<file>`
(its `examples/*.brief`), capped at 64 KiB per guide, 16 KiB per example and eight examples, and
the prompt `model_brief(copy, template?)`, which puts the steps, the template's slots, skeleton,
guide and examples in front of the copy. A restricted folder's own templates serve neither.

The command is the built CLI, `node <repository>/apps/cli/dist/index.js` (`pnpm cli` builds it).

Name the project folder as the argument: a host may start the server in a folder of its own
choosing, and the argument is what makes the answer not depend on it.

**Claude Code**:

```
claude mcp add tyto -- node C:/projects/tyto/tyto/apps/cli/dist/index.js mcp C:/projects/my-project
```

**Claude Desktop**, in `claude_desktop_config.json` (Settings ▸ Developer ▸ Edit Config), then
restart the app:

```json
{
  "mcpServers": {
    "tyto": {
      "command": "node",
      "args": ["C:/projects/tyto/tyto/apps/cli/dist/index.js", "mcp", "C:/projects/my-project"]
    }
  }
}
```

The server's own messages, and anything a plugin prints, go to stderr, which both hosts keep in
their MCP log; stdout carries the protocol only. The window refuses `tyto mcp` in its command
panel.

`tyto mcp --window [folder]` relays the same stdio to a running window instead (ADR 0180): the
window listens on a named pipe or Unix socket announced in `TYTO_HOME/windows/<pid>.json`,
checks the record's token on the first line, and serves the same tools through `serveAgent`.
The status bar shows **Agent connected** while one is, and its click cuts them. Served by a
window, the server adds `brief_in_front` and `selection` (reads of what is on screen, offered
in any folder) and `open_file` and `show_format` (window actions, trusted folders only, asked
first unless `agentsWindowActions` is `allow`). `agentsListen: false` stops the listener. `propose_edit` shows an edit of the document in front for the person
to accept (one undo step, no save) or reject, and answers at once with an id;
`proposal_status` says whether it was accepted, rejected, became stale or is gone.

An agent started in Tyto's own terminal reaches the window without `tyto` (ADR 0181): the package
runs `out/relay/agent-relay.js`, the relay alone (`@tyto/command-line/relay`), on its bundled
Node. Every terminal the window opens carries `TYTO_WINDOW=<pid>`, which the relay prefers over the
folder rule. **Open an Agent Here** (`terminal.openAgent`) starts `agentCommand` (default `claude`)
with `--mcp-config <TYTO_HOME>/agents/window-<pid>.json`, or `codex` with `-c mcp_servers.tyto.*`
overrides. Nothing is written into the workspace, and nothing is installed.
