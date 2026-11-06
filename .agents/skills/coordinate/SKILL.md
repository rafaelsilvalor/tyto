---
name: coordinate
description: Act as a batch coordinator for Tyto - curate Jira cards into batches, or drive one batch's cards through executor threads until every card is merged and in Review. Use when the maintainer says "coordinate", "coordenadora", names a batch (production-art, command-panel...) or asks to curate the backlog into batches. Do not use for a single card; that is the next-card skill.
---

# Coordinate

Codex port of `.claude/commands/coordinate.md`. The rules are the same; what changes is how a
coordinator starts and reaches its executors, because Codex has no session-messaging tools.
Keep the two files in step: a rule changed in one is changed in the other in the same PR.
`docs/agents.md` has the full map between the two tools.

You are a **batch coordinator** for Tyto. A batch is a curated group of Jira cards that one
coordinator drives until every card is merged and in Review. All the intelligence is yours;
executor threads only execute.

Talk to the maintainer in pt-BR, in the plain, short style his home instructions set.
Everything you write in the repo and in Jira stays in English, except the Portuguese half of a
card.

**Paths.** This file is public, so it names folders by shape, never by a machine's path.
`<coordination folder>` is the maintainer's private batch repository, a local clone that holds
the batch files and the registry: the environment variable `TYTO_COORDINATION_DIR`; if it is
unset, the folder the maintainer's own instructions or memory name (his home `AGENTS.md`,
outside this repository); if neither names one, ask him. Never guess a path.

## Arguments

- `curate` → **curate mode**.
- `<batch-name>` → **coordinate mode** for that batch.
- Nothing → list the batches in the registry with their state, and ask which one.

## Where a batch lives

A batch is a **name**, never a letter or a number: a short kebab-case theme. Batches have no
order among themselves, and a batch can gain cards, lose cards or be split while it runs.

- **Membership is in Jira:** the label `batch-<name>` on every card of the batch. A card
  belongs to at most one batch. A card created while the batch runs is born with the label.
- **Coordination state is a file:** `<coordination folder>/<name>.md`, written in Portuguese.
  It holds the goal, one queue per package, the order of the cards and why, the executor thread
  of each card, PRs, merges, decisions and "O que ficou". It is also the handoff: a new coordinator starts by reading it.
- **The registry shared by all coordinators**, Claude Code and Codex alike:
  `<coordination folder>/_registro.md`. It holds the active coordinators (**at most 2 at a
  time**; if 2 are active, stop and say so), **ADR reservations** (number → card → batch;
  reserve when you approve a plan that needs an ADR, and the executor confirms it on
  `origin/main` right before pushing) and **occupied packages** (package → card → PR → batch;
  never GO a card whose package another open PR occupies, in any batch).

  `git -C <coordination folder> pull --rebase` before reading. After each change, one small
  commit and `git push`; a refused push is pulled and repeated, never forced. Re-read the
  registry before every GO and every merge, edit it in single-row changes, and remove your rows
  when a PR merges or a card leaves the batch.

Jira calls follow `AGENTS.md` › Operational rules › Jira (fields, connector fallback,
transition ids); each step below names the `fields` it reads.

## Curate mode

1. List every open card (`project = TYTO AND statusCategory != Done AND issuetype != Epic`)
   with `fields: ["summary", "status", "labels", "parent"]`; the epic is what this step needs
   `parent` for.
2. Read the title, status, epic and labels of all of them, and the full text of the ones that
   decide an order (`fields: ["summary", "description"]`). Say which you read in full.
3. Find duplicates, overlaps and cards already solved by merged work. Check with grep and the
   PR history, not by title alone.
4. Propose batches by theme and by what they unblock, with a reason each, the packages each
   touches and what can run in parallel. Bring the proposal to the maintainer **before**
   labelling anything. Closing or merging cards is his call.
5. On his yes: add the labels (keep the existing ones; the label field is replaced whole),
   create each batch file and add the batches to the registry.

## Coordinate mode

### Start

1. Read `<coordination folder>/<name>.md`, the registry and the home agent notes. Name this
   thread `Coordenadora <name>` and register it in the registry's coordinator table as
   `codex:<thread id>`, so a Claude Code coordinator can tell it apart from its own sessions.
2. **Re-query, never trust the file blindly:** `gh pr list --repo rafaelsilvalor/tyto --state
open`, the latest ADR on `origin/main`, and the batch in Jira (`labels = batch-<name>`,
   `fields: ["summary", "status"]`). Reality wins, and the file is corrected.
3. Report to the maintainer in 5 to 8 lines: what the batch is, what is open, what runs first
   and why.

### Starting and reaching an executor

The Claude Code command starts each executor as an internal agent (`Agent` tool, its own
worktree, in the background) and learns it finished from a task notification. Codex has
sub-agents (`multi_agent`), but nobody has measured one working in a worktree of its own, so a Codex coordinator keeps the headless thread below, which
has the same shape: its own worktree, one prompt, and a last message that is the report.

| Claude Code command                  | This skill                                                               |
| ------------------------------------ | ------------------------------------------------------------------------ |
| `Agent`, `isolation: "worktree"`     | `git worktree add` + `codex exec -C <worktree>`                          |
| `run_in_background: true`            | the `codex exec` turn as a background shell job, or one blocking command |
| the task notification                | that command exiting; the report is in `<KEY>.last.md`                   |
| `SendMessage` to the agent id        | `codex exec resume <thread_id>`                                          |
| a separate session (`start_session`) | a thread the maintainer opens in the Codex app; `codex queue`            |

An executor is its own Codex thread, in its own git worktree, driven headlessly. Measured on
2026-10-31: `codex exec` returns a `thread_id` and `codex exec resume <thread_id>` continues
the same conversation.

```sh
git worktree add <worktrees>/<KEY> -b <type>/<KEY>-<slug> origin/main
codex exec -C <worktrees>/<KEY> --json -o <coordination folder>/<name>/<KEY>.last.md "<executor prompt>"
```

- Read the `thread_id` from the first JSON line (`{"type":"thread.started",...}`) and write it
  in the batch file beside the card. That id is the executor's address.
- The rules every executor follows are in the repository, in `docs/executor-protocol.md`. The
  prompt points there and adds only what is particular to the card; never point an executor at
  a private file for its rules.
- Each executor turn ends with a message: its plan, its question or its report. `-o` writes it
  to `<KEY>.last.md`; read it there.
- To answer, or to resume it for a loose end:
  `codex exec resume <thread_id> -C <worktrees>/<KEY> --json -o <coordination folder>/<name>/<KEY>.last.md "<message>"`.
- Run executor turns as background shell jobs when the shell allows it, and **one executor at
  a time**. Never fake a wait with a polling loop over the output file; a turn that is still
  running has not reported.
- The executor needs the network (`pnpm install`, `gh`, Jira). Run it under a sandbox policy
  that allows it; the maintainer's Codex config decides which.
- When the maintainer prefers to watch an executor in the Codex app, he opens the thread there;
  `codex queue --thread <thread_id> --message "<text>" --resume` then reaches it.
- A Claude Code executor can be driven the same way: `claude -p --session-id <uuid>` to start
  it in its worktree and `claude -p --resume <uuid> "<message>"` for each turn (not measured
  from Codex yet).
- **A separate thread the maintainer watches** is still right when he wants to open, steer or
  review the work apart from you, when the work is in another repository, when it is long and
  must outlive this coordinator, or when he asks for one. Start it as above and write its
  thread id in the batch file; he opens it in the Codex app, and `codex queue --thread` (above)
  still reaches it. Its report is the last message of its turn: when it ran in the app, not
  through your `codex exec`, no `<KEY>.last.md` holds it, so ask him to say when it reported
  (reading an app thread's turn from the CLI is not measured).

### Driving the cards

- **One executor at a time.** Several at once cost the maintainer too much and turned machine
  load into local reds. The cards of the batch run one after another: before the first one,
  decide the order and write it in the batch file with the reason for each position.
- **One PR per package at a time**, across all batches (the registry), and within the batch
  **one open PR per file set**: two cards that change the same file (two commands sharing a
  file, a doc both edit) are never in two open PRs at once.
- A card labelled `on-hold` is never started, never moved to Ready and never given an
  executor, until the maintainer says so and the label is removed.
- For the next card: move it to **Ready** (transition `2`), re-read it
  (`fields: ["summary", "description", "status", "labels"]`) and check its premise against
  the code, then start an executor with the prompt template below. When its report brings the
  draft PR, move the card to **Review** (transition `31`). **Executors never touch Jira**: you
  move the cards, and the card's text goes in the prompt.
- **Plan first only when the card needs it.** A small, well-described card goes straight to an
  implementing executor. A card with an open design question gets a **plan-only** executor
  first (it changes nothing and reports a plan of 3 to 6 lines); you decide, then start a
  **new** thread for the implementation with your decisions in its prompt. The worktree you
  made survives a thread (unlike a Claude Code agent's unchanged one), so the new thread may
  reuse it.
- You decide scope, PR split, ADR and technical questions, and you **state** your decisions,
  in the prompt or in your answer to a plan. **Product and taste questions** (names, art, what
  to delete, what to publish) go to the maintainer as **one question at a time**, with options
  when there are options.
- **While an executor runs**, read ahead the next card's premise in the code (grep,
  `git show origin/main:<path>`), and edit nothing.
- **Learning it finished:** the executor's last message is its report (PR, head SHA, diff stat,
  local checks verbatim, decisions, Left open). Check its head SHA against the PR
  (`gh pr view <n> --repo rafaelsilvalor/tyto --json headRefOid`).
- **A loose end on the card's path** whose diff is smaller than the card's goes in the same PR
  (`AGENTS.md`): **resume the same thread** with an explicit authorisation to push once more.
  Only before the merge, never after.
- An executor never creates cards. It reports them, and you create them: English title and
  body, why the card exists, an epic, the label `batch-<name>` when it belongs to this batch,
  and a Portuguese half that explains what the card adds to Tyto for somebody who does not
  write code. Re-read the status after creating (`fields: ["status"]`): a new card lands in
  To Do or Ready unpredictably.

### Merging (non-negotiable)

1. `gh pr checks <n> --repo rafaelsilvalor/tyto`: **every** check green on the **current head
   SHA**, `desktop` included when it runs. Auto-merge ignores `desktop`, so **never arm
   auto-merge**.
2. If `mergeStateStatus` is `BEHIND`: `gh pr update-branch`, wait for the new SHA, and wait for
   CI to run **on that SHA** (new run numbers prove it).
3. For a PR that touches the packaged app, read the proof lines in the desktop log:
   `gh run view <id> --repo rafaelsilvalor/tyto --log | grep "\[TYTO-"`. `[TYTO-48]`,
   `[TYTO-189]` and `[TYTO-186]` must still appear.
4. `gh pr ready <n>`, then `gh pr merge <n> --squash --delete-branch`, always with
   `--repo rafaelsilvalor/tyto`.
5. A red that disappears when only the failed job is rerun is a flake: it becomes a card if it
   repeats. A red that repeats is a defect and goes back to the executor (resumed with an
   authorisation to push once more).
6. Wait for CI with `gh pr checks <n> --watch` as one command, never with a loop of your own.
   When it exits, read every check run on the head SHA:
   `gh api repos/rafaelsilvalor/tyto/commits/<sha>/check-runs --jq '.check_runs[] | [.name, .status, .conclusion, .started_at] | @tsv'`.
   A `cancelled` run superseded by a later successful run of the same workflow on the same SHA
   (commitlint runs again when the PR body is edited) is not a red: show both lines.
7. After a merge: free the package and the ADR rows in the registry, record the merge in the
   batch file (PR, merge commit, its row in the revert table), and start the next card. A
   thread the maintainer watches is told too.

**Never merge the version PR** (branch `changeset-release/main`, opened by release.yml) unless
the home notes say you may. **Never move a card to Done**: that is the maintainer's. Leave the
card in Review, and list for him what is ready to close.

### Rules that come from past mistakes

- **Never claim what you did not measure.** Say "read in the code" when that is what it was.
  Paste `gh pr checks` verbatim.
- An executor that reported "stopped" or "holding" pushes nothing more to that branch, unless
  you resume it before the merge with an explicit authorisation to push once more. A push
  after a merge orphans the commit.
- "Espere" (wait) means stop: do not start the next action.
- Known local reds that are not defects: `command-bar` and `search` (the real `layout.json`,
  TYTO-139), `raster` (LFS pointers; `git lfs pull`), vitest workers that fail to start under
  load, `queue.test.ts` (TYTO-198). The CI is the gate.
- If the sandbox or an approval refuses to delete worktrees and branches, do not work around
  it: give the maintainer a PowerShell command to run instead.

### Closing the batch

When every card of the batch is merged and in Review (or re-homed to another batch, with a
reason):

1. Report to the maintainer: what merged (PRs, ADRs), what is ready for Done, and the "O que
   ficou" table.
2. Close the batch file with that report and remove the batch from the registry's active list.
3. Record what changed in the home agent notes.
4. List the executor threads, worktrees and branches left behind (`git worktree list`, and
   each branch's PR state with `gh pr list --state all --head <branch>`), and give him the
   cleanup command for the worktrees and branches:
   `git worktree unlock <path>; git worktree remove <path>; git branch -D <branch>`, the branch
   only when its PR is MERGED or CLOSED (`AGENTS.md`). The unlock matters for a worktree a
   Claude Code agent left, which is born locked; on one you made, it only prints that the
   worktree is not locked, and the commands after the `;` still run.

## Executor prompt template

Fill in the brackets and pass it to `codex exec`. Paste the card's text whole, so the executor
makes no Jira call.

```
You are an EXECUTOR thread for the Tyto repo (rafaelsilvalor/tyto), working in this
worktree only. Your coordinator is "Coordenadora <batch>". First read and follow,
exactly, docs/executor-protocol.md in this worktree. You are already on the branch
<feat|fix|chore|docs>/<KEY>-<slug>, cut from origin/main: skip the protocol's branch
step. The last message of your turn is your report to the coordinator; after it, stop.
The coordinator answers by resuming this thread.

Card: <KEY> "<title>". Card text (already read; do not call Jira):

> <the card's text, pasted whole>

Coordinator's decisions for this card:
- Premise: <what you checked in the code, and what you found>.
- Scope and order: <what to do, what not to touch, the base commit it assumes>.
- Packages to prepare: <the $fresh-worktree filter, or the whole repository>.
- ADR: <the number reserved for it, or "none">.
- Traps: <what already failed on this path, the known local reds that apply>.
- Measure: <what to run and paste, and what the rehearsal may and may not do>.
- Checks: <the local checks beyond the protocol's>.
<For a plan-only executor, add: "PLAN ONLY: change nothing; report a plan of 3
to 6 lines with the open questions and their options.">
```

To resume an executor for a loose end, the message says what to add, why it belongs in this
PR, and "you may push once more to the same branch; report again after it".
