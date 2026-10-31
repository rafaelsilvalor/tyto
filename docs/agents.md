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

The four repository commands have Codex ports: `next-card`, `handoff`, `coordinate` and
`new-template`. **Each port names its source, and a rule changed in one is changed in the other
in the same PR.** The two formats differ only in the frontmatter (a skill needs `name` and
`description`) and in the tools the text names.

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
session id, or `codex:<thread id>`. That is how the next coordinator, of either tool, finds
them.
