# 0061 — A queue folder chooses its file types

Status: accepted · 2026-10-01 · TYTO-188 · amends ADR 0044's "The queue stays PNG-only, by
decision"

## Context

ADR 0044 kept the desktop's local queue on a fixed `[{ kind: 'png' }]`. Rendering every
installed kind would have changed what every unattended folder produced the day somebody
installed an exporter. It left the parity fix to this card: `tyto watch` chooses its kinds with
`--types`, and the window could not choose at all.

Three questions had to be settled with the choice:

- where it is kept, and how a `settings.json` written before it still reads;
- what a task does when a chosen kind's plugin has been removed since;
- what ADR 0059's leftover rule does to the old files when a folder drops a kind.

## Decision

**Each queue folder chooses its kinds in the queue panel**, in a _Produces_ row (pt-BR
_Gera_). The row has one checkbox per kind, in capitals. The options are what `export:kinds`
answers, so an installed exporter's kind is offered beside Tyto's four. The last ticked box is
disabled, so a folder always produces something. The row appears only once a folder is
chosen, as auto-run does. The choice travels through one new channel, `queue:set-kinds`, and
`queue:list`'s answer carries it as `kinds`.

**Kept per folder in `settings.json`**, as `queueKinds`: absolute folder path → non-empty list
of kinds. Per folder, because a folder is a contract with whoever drops tasks into it, and
pointing the window at another queue must not change what the first one hands back. **A folder
with no entry produces PNG alone**, which is ADR 0044's default and stays it: no folder changes
what it produces unless a person chose it. The field is defaulted, so an older `settings.json`
reads with every folder on PNG. It is also caught, so a hand-broken value costs this field and
not the whole record. Without the catch, one bad value reset the templates folder and the queue
folder with it.

**A kind no exporter produces is left out, with a warning, not a failed task.** The queue asks
the export service to drop unavailable kinds (`dropUnavailableKinds`). The service checks the
run's own host, the one `runJob` looks kinds up in, so a kind is dropped exactly when the job
would have refused it. Each dropped kind is one `W_QUEUE_KIND_UNAVAILABLE` warning, in the
task's diagnostics and in its `result.json`. When nothing chosen is left, the task produces
PNG rather than nothing. The saved choice is not rewritten, so reinstalling the plugin brings
the kind back. The panel still lists the missing kind, ticked, so a person can see it and
untick it. The export box does not drop anything: it only offers what `export:kinds` answered,
and an unknown kind there is still the run's failure.

**Dropping a kind from a folder, with ADR 0059.** Going from PNG + SVG back to PNG changes the
next task, nothing already on disk:

- A **new task** has an empty `out/`, so there is nothing to remove.
- A **task run again in the same `out/`** goes through ADR 0059's rule unchanged. This covers
  _Try again_ after a failure, or the same id dropped again. The SVGs were listed by the last
  `result.json` and are not produced this time, so each is removed with a
  `W_LEFTOVER_REMOVED`. A file kept for one of ADR 0054's reasons gets a `W_LEFTOVER_KEPT`
  instead.
- **Tasks already in `done/`** are not touched: nothing re-renders them.

The same holds for any kind dropped, including one dropped because its plugin was removed.

## Consequences

- The window and `tyto watch` can now produce the same kinds from one folder. They choose them
  in two places: the panel for the window, `--types` for the watcher. Nothing makes the two
  agree, as nothing did before.
- A program reading `outbox/<id>/out/` may find kinds other than PNG. The render contract
  already says to read `result.json`'s `artifacts[]`, each with its `kind`.
- `W_QUEUE_KIND_UNAVAILABLE` is a new warning code: not a breaking change under the render
  contract.
- The queue still runs one consumer per folder. Two programs on one folder still render a task
  twice.
