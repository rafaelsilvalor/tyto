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

## Arguments

- `curate` → **curate mode**.
- `<batch-name>` → **coordinate mode** for that batch.
- Nothing → list the batches in the registry with their state, and ask which one.

## Where a batch lives

A batch is a **name**, never a letter or a number: a short kebab-case theme. Batches have no
order among themselves, and a batch can gain cards, lose cards or be split while it runs.

- **Membership is in Jira:** the label `batch-<name>` on every card of the batch. A card
  belongs to at most one batch. A card created while the batch runs is born with the label.
- **Coordination state is a file** in the maintainer's private batch repository, a local clone
  whose path his home `AGENTS.md` gives (below, `<batches>`). `<batches>/<name>.md` is written
  in Portuguese and holds the goal, one queue per package, the executor thread of each card,
  PRs, decisions and "O que ficou". It is also the handoff: a new coordinator starts by reading
  it.
- **The registry shared by all coordinators**, Claude Code and Codex alike:
  `<batches>/_registro.md`. It holds the active coordinators (**at most 2 at a time**; if 2
  are active, stop and say so), **ADR reservations** (number → card → batch; reserve when you
  approve a plan that needs an ADR, and the executor confirms it on `origin/main` right before
  pushing) and **occupied packages** (package → card → PR → batch; never GO a card whose
  package another open PR occupies, in any batch).

  `git -C <batches> pull --rebase` before reading. After each change, one small commit and
  `git push`; a refused push is pulled and repeated, never forced. Re-read the registry before
  every GO and every merge, edit it in single-row changes, and remove your rows when a PR
  merges or a card leaves the batch.

## Curate mode

1. List every open card (`project = TYTO AND statusCategory != Done AND issuetype != Epic`).
2. Read the title, status, epic and labels of all of them, and the full text of the ones that
   decide an order. Say which you read in full.
3. Find duplicates, overlaps and cards already solved by merged work. Check with grep and the
   PR history, not by title alone.
4. Propose batches by theme and by what they unblock, with a reason each, the packages each
   touches and what can run in parallel. Bring the proposal to the maintainer **before**
   labelling anything. Closing or merging cards is his call.
5. On his yes: add the labels (keep the existing ones; the label field is replaced whole),
   create each batch file and add the batches to the registry.

## Coordinate mode

### Start

1. Read `<batches>/<name>.md`, the registry and the home agent notes. Name this thread
   `Coordenadora <name>` and register it in the registry's coordinator table as
   `codex:<thread id>`, so a Claude Code coordinator can tell it apart from its own sessions.
2. **Re-query, never trust the file blindly:** `gh pr list --repo rafaelsilvalor/tyto --state
open`, the latest ADR on `origin/main`, and the batch in Jira (`labels = batch-<name>`).
   Reality wins, and the file is corrected.
3. Report to the maintainer in 5 to 8 lines: what the batch is, what is open, what runs first
   and why.

### Starting and reaching an executor

An executor is its own Codex thread, in its own git worktree, driven headlessly. Measured on
2026-10-31: `codex exec` returns a `thread_id` and `codex exec resume <thread_id>` continues
the same conversation.

```sh
git worktree add <worktrees>/<KEY> -b <type>/<KEY>-<slug> origin/main
codex exec -C <worktrees>/<KEY> --json -o <batches>/<name>/<KEY>.last.md "<executor prompt>"
```

- Read the `thread_id` from the first JSON line (`{"type":"thread.started",...}`) and write it
  in the batch file beside the card. That id is the executor's address.
- Each executor turn ends with a message: its plan, its question or its report. `-o` writes it
  to `<KEY>.last.md`; read it there.
- To answer, give GO or send a correction:
  `codex exec resume <thread_id> -C <worktrees>/<KEY> --json -o <batches>/<name>/<KEY>.last.md "<message>"`.
- Run executor turns as background shell jobs when the shell allows it, and at most **3
  executors at once**. Never fake a wait with a polling loop over the output file; a turn that
  is still running has not reported.
- The executor needs the network (`pnpm install`, `gh`, Jira). Run it under a sandbox policy
  that allows it; the maintainer's Codex config decides which.
- When the maintainer prefers to watch an executor in the Codex app, he opens the thread there;
  `codex queue --thread <thread_id> --message "<text>" --resume` then reaches it.
- A Claude Code executor can be driven the same way: `claude -p --session-id <uuid>` to start
  it in its worktree and `claude -p --resume <uuid> "<message>"` for each turn (not measured
  from Codex yet).

### Driving the cards

- **One PR per package at a time**, across all batches (the registry). Cards in different
  packages run in parallel.
- A card labelled `on-hold` is never started, never moved to Ready and never given an
  executor, until the maintainer says so and the label is removed.
- For the next card of each free package: move it to **Ready**, re-read it and check its
  premise against the code, then start an executor with the prompt template below.
- The executor sends a plan of 3 to 6 lines. You decide scope, PR split, ADR and technical
  questions, and you **state** your decisions. **Product and taste questions** (names, art, what
  to delete, what to publish) go to the maintainer as **one question at a time**, with options
  when there are options.
- An executor never creates cards. It reports them, and you create them: English title and
  body, why the card exists, an epic, the label `batch-<name>` when it belongs to this batch,
  and a Portuguese half that explains what the card adds to Tyto for somebody who does not
  write code. Re-read the status after creating: a new card lands in To Do or Ready
  unpredictably.

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
   repeats. A red that repeats is a defect and goes back to the executor.
6. Wait for CI with `gh pr checks <n> --watch` as one command, never with a loop of your own.
7. After a merge: tell the executor, free the package and the ADR rows in the registry, and
   update the batch file.

**Never merge the version PR** (branch `changeset-release/main`, opened by release.yml) unless
the home notes say you may. **Never move a card to Done**: that is the maintainer's. Leave the
card in Review, and list for him what is ready to close.

### Rules that come from past mistakes

- **Never claim what you did not measure.** Say "read in the code" when that is what it was.
  Paste `gh pr checks` verbatim.
- An executor that reported "stopped" or "holding" pushes nothing more to that branch. A push
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
4. List the executor threads and worktrees left behind, and give him the cleanup command for
   the worktrees and branches.

## Executor prompt template

Fill in the brackets:

```
You are an EXECUTOR thread for the Tyto repo (rafaelsilvalor/tyto), working in this
worktree only. Your coordinator is "Coordenadora <batch>". You talk to it through the
last message of each of your turns: end every turn with your plan, your question or
your report, and stop. The coordinator answers by resuming this thread.
Reply in pt-BR if the maintainer talks to you; everything in the repo is in English.
Read AGENTS.md and docs/architecture.md first.

Card: <KEY> "<title>". Read it in full in Jira. <One paragraph: what matters, known
traps, the ADR number reserved for it if any, packages it may touch.>

Protocol (non-negotiable):
1. Before code, end your turn with a plan of 3 to 6 lines, including any ADR-level
   decision. Write no code until a later turn says GO.
2. You are on a fresh branch from origin/main: <type>/<KEY>-<slug>. No stacked PRs.
3. Vitest tests. Perturb each mechanism you add and paste the red output. Locally run
   only: typecheck, lint, the tests of the packages you touch, and the desktop e2e
   file(s) the card creates or changes. Do NOT run the whole test:desktop locally: the
   draft PR's CI runs the full suite. Desktop e2e with its own --user-data-dir and
   TYTO_HOME, closeApp(), and a fresh build first (`TURBO_FORCE=1 pnpm build`). An e2e
   test asserts only what needs the real window; logic is tested in packages/* or
   jsdom, and a file has a 60 s budget on CI (ADR 0105, docs/conventions.md).
4. Known local reds that are not defects: command-bar and search, raster (LFS), vitest
   workers under load, queue.test.ts. CI is the gate.
5. Conventional Commit with the key, subject of at most 72 characters, one -m per
   paragraph, NO trailers. About 1,500 lines per PR at most; above that, stop and
   propose a split.
6. DRAFT PR only. Never merge, never arm auto-merge, never mark ready. Move the card to
   Review. Report `gh pr checks <n> --repo rafaelsilvalor/tyto` verbatim once ALL
   checks have finished, plus a "Left open" table, then STOP. After you report, push
   nothing more to that branch.
7. Do not create Jira cards: report them to the coordinator.
Always pass --repo rafaelsilvalor/tyto to gh.
```
