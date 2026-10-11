# 0079 — User scripts are not a tier yet: the file contract is enough

Status: accepted · 2026-10-11 · TYTO-209 (absorbed TYTO-106) · keeps ADR 0011, builds on ADR 0049,
ADR 0050 and ADR 0067

## Context

TYTO-209 asked what a "script" is in Tyto now that installed plugins exist: VS Code has
`tasks.json` and user snippets, Zed has tasks, vim has a vimrc. It offered four answers — (a) a
local, unpublished plugin; (b) a task list of command ids and CLI invocations, as data; (c) both;
(d) nothing, because the file contract is enough — and said the ADR must beat (d) before
anything is built. TYTO-106, folded into it on 2026-09-30, had named (d) the answer to beat and
asked for a few things to be decided out loud whatever the outcome.

**The file contract** is ADR 0011's: a task folder goes in, `tyto render` (or `tyto watch`, its
convenience loop) runs, and `out/`, `result.json` and an exit code come back — `0` ok, `1` error
diagnostics, `2` internal failure, retryable (`docs/render-contract.md`). A step before or after
a render is a line in a Makefile, a shell pipeline or a CI job, and needs nothing from this
repository.

**What a plugin command can do today was read in the code** at `origin/main` 814f236 and
re-checked at 0aad8b7, before anything else was argued. It decided the outcome.

- The plugin contribution type has no `run`. `packages/plugin-api/src/contributions.ts:229-231`:

  ```ts
  export interface EditorCommand extends Contribution {
    readonly title: string;
  }
  ```

  and `Contribution` is `{ readonly id: string }` (`contributions.ts:38-46`). A plugin's
  `editor.command` is a name and a title.

- In isolation it crosses as data with an empty callable list.
  `packages/plugin-api/src/isolation/points.ts:301-305`:

  ```ts
  'editor.command': {
    method: 'registerCommand',
    data: z.strictObject({ id: z.string().min(1), title: z.string() }),
    callables: {},
  },
  ```

  so an installed plugin has no handle the host could call even if it wanted to.

- Nobody reads what plugins register. `registry.commands()` is declared at
  `packages/plugin-api/src/host.ts:171`, and the only caller under `apps/` and `packages/` is
  `packages/plugin-api/src/host.test.ts:351`.

- Ctrl+K does not list plugin commands. The command bar is painted from `commandEntries()`
  (`apps/desktop/src/renderer/main.ts:1953-1958`), which maps `registry.list()`
  (`main.ts:1855`) — the `@tyto/editor` registry the window builds at `main.ts:816`. Its only
  registrations outside the built-in set are the window's own recent files, panel toggles and
  tab slots (`main.ts:1344`, `1744`, `1778`, `1832`). No plugin contribution reaches it.

- A confined plugin process may read two paths and write none. The CLI starts it with
  `--permission` and `--allow-fs-read` for its own folder and bootstrap only
  (`apps/cli/src/plugins/plugin-process.ts:12`, `:66`); the desktop does the same on its bundled
  Node (`apps/desktop/src/main/plugin-process.ts:11-12`, `:81-82`). There is no
  `--allow-fs-write` and no grant for the brief's folder.

## Decision

**(d): not now.** Tyto adds no script tier, no task list and no local-plugin folder. The file
contract is the way to automate around Tyto today, and this ADR is the written "no" TYTO-106
asked for, with the cases below. There is no spike: the card made one conditional on an answer
other than (d).

### The three shapes, tested against the file contract

1. **The one-off, per-project step** — six lines that live beside the briefs, not distributable,
   not versioned as a package. The file contract serves it today: a `Makefile`, an `npm` script
   or a shell file in the project calls `tyto render` and does its six lines before or after,
   with no manifest and no install. What the file contract does not give is a **key in the
   window**. But a script tier would not give it either, because there is nothing in the window
   for a key to run (see the finding). So this shape does not justify a tier yet.

2. **The step that should not be trusted** — one that must never be in a position to ask for
   `fetch` or `credentials`. The file contract gives it exactly that: a process Tyto never
   started holds no `PluginHost` and no `safeStorage` (ADR 0011, `credentials` behind the host).
   The other candidate, a sandboxed script with plugin isolation and no manifest, would run on
   the confined runtime of ADR 0049/0050/0067, which today reads its own folder and writes
   nothing. **A confined script could neither write a file nor read the brief**, and the
   command it would register could not be run by anyone. That is the "worst of both worlds"
   TYTO-106 predicted, now measured: the ceremony of isolation with none of the reach that
   makes a script worth writing. This shape does not justify a tier.

3. **The step that is not an extension point** — a pre-render fixup that is none of the
   contribution types. Outside Tyto it needs no type at all: it edits the task folder and then
   calls `tyto render`. Inside Tyto the nearest type is `editor.command`, and that runs nothing.
   Widening the vocabulary for it would add a thirteenth point for one script. This
   shape does not justify a tier.

### The need behind "export grid and story into ./entregas with one key"

The card's example is not a script. It is a fixed choice of formats, kinds and a destination,
which is **an export preset**: data, saved once, run from the window or the CLI. **No card
exists for it, and this ADR does not decide it**; it is an open question for whoever picks up
export ergonomics next.

### What reopens the question

The question is reopened by both of these, not by either alone:

- **TYTO-261** — a plugin's `editor.command` that actually runs, from Ctrl+K and from the CLI —
  together with a minimal context for `run`: what a command may read (the active brief, its
  path) and what it may write, granted through the plugin permissions of ADR 0007 and enforced
  by the runtime of ADR 0049/0050. Until a plugin's command runs, a script built on plugins has
  nothing to stand on.
- **A workspace-trust rule** for anything per-project: a script list committed in `.tyto/`
  beside the briefs runs only after the person approves it once for that folder, as VS Code's
  workspace trust does. Without it, cloning a project is enough to run somebody's code.

When both exist, the candidates are (a), (b) and (c) again, and the ADR that answers them
supersedes this one.

### Decided out loud (TYTO-106)

- **Where a script runs.** In CI, or in a person's shell around `tyto render`, it is ordinary:
  the person or the pipeline chose to run it, and Tyto is a program it calls. **The desktop app
  running a script on a designer's machine is a different risk** and gets a different answer:
  today, it does not. If it ever does, it is through the confined runtime of ADR 0050 and 0067
  (a bundled Node started with `spawn`, `--permission`), never a `utilityProcess`, never a
  worker, and never the renderer (ADR 0001).
- **What a script is never given.** Credentials, a `PluginHost`, and Tyto's own privileges. A
  script is not a back door to `safeStorage` or to the host's `fetch`; a step that needs a
  token holds its own, outside Tyto, which is ADR 0011's boundary.
- **Supply chain.** A script list beside the briefs would make cloning a project enough to run
  its code. Tyto declares no such file today, so the surface does not exist. Reading one is
  gated on the trust rule above.

## Consequences

- No code, no new point, no new diagnostic. The card's spike and its desktop e2e are not built.
- `docs/plugin-api.md` and `docs/plugin-authoring.md` no longer promise `run(ctx)` and `undo`
  on a plugin's `editor.command`: they say it is `{ id, title }`, data that nothing runs yet,
  and point at TYTO-261 and this ADR. The `run`/`undo` shape described there is
  `@tyto/editor`'s registry entry, which the window's built-in commands use.
- Automating around Tyto is documented as the file contract (`docs/render-contract.md`), which
  already is the contract Jacurutu uses.
- An export preset is an open question with no card.
- Risk to watch: a plugin starts registering `editor.command` expecting it to appear in Ctrl+K.
  It will not, silently, until TYTO-261.
