# 0108 — A locked artwork is worth retrying

Status: accepted · 2026-10-20 · TYTO-245

## Context

`docs/render-contract.md` (ADR 0011) gives a caller two non-zero exit codes and one rule:
**only `2` is worth retrying.** TYTO-129 and TYTO-243 applied it to the delivery files: a name
held by the wrong kind of entry — a folder where a file goes, or the reverse — fails the same
way until somebody moves it, so it is exit `1` with a sentence; a real lock or an unwritable
folder is a throw, and exit `2`.

The artwork files did not follow it. `ArtifactSink.write` was documented to **reject rather
than return a `Result`**, and `runJob` caught every rejection at its own edge and turned it
into `E_OUTPUT_WRITE`, a non-fatal error: that frame failed, the others were written, and the
run exited `1` whatever the cause. To keep TYTO-243's sentence for a folder in the way, the
filesystem adapter had to throw it as an `Error`'s text. The TYTO-243 executor measured the
consequence on Windows: with `grid-01.svg` held open by another program
(`[IO.File]::Open(..., 'None')`), `tyto render` exited `1` with `E_OUTPUT_WRITE` and the raw
`EPERM … rename` — "change something first" for a lock a retry would have outlasted. The
copied brief and `result.json`, held the same way, already exited `2`.

The job could not tell the two apart because the port gave it one channel for both.

## Decision

**`ArtifactSink.write(artifact)` answers what it can explain and rejects what it cannot.** Its
type is `Promise<Diagnostics>`, the shape `TaskOutput.finish` and `placeAtomic` already have:

- **Returned diagnostics** are a failure the sink can name and somebody has to fix — today,
  `E_OUTPUT_FILE_BLOCKED` for a folder at the artwork's name. The job fails that frame with
  them, writes the others, and the report survives: exit `1` with the sentence, as before
  except for the code. An empty list means the file is written; a returned warning rides with
  the artifact.
- **A rejection** is the operating system's answer that nobody explained — a file another
  program holds open, `EACCES`, `ENOSPC`. The job **no longer turns it into a diagnostic**. It
  keeps the first cause, starts no further frame (the same early return a cancelled run
  takes), lets the frames in flight settle so nothing is still writing into the folder, and
  rejects with that cause. `tyto render` reports it where every other throw is reported: an
  internal failure, exit `2`, and no `result.json` — the same as a locked `result.json` today.
  The desktop's Export dialog shows it as the run's `failure`, not as a diagnostic.

This reverses the "reject, the job turns it into a diagnostic" decision recorded on the port
in `packages/pipeline/src/artifact.ts`. It is a change to a public `@tyto/pipeline` contract,
so a third-party sink — there is none in this repository besides `fsTaskOutput` and the
tests' fakes — has to return `[]` instead of `undefined`, and the type checker says so.

**`E_OUTPUT_WRITE` has no producer any more, and stays in the catalogue.** The catalogue had
never deleted a code, so there was no convention; this ADR sets one. A code is public — a
`DiagnosticCode` a handler can switch on, and a `result.json` written before this change can
carry it — so a retired code keeps its entry with a summary that starts "No longer produced
since ADR NNNN" and a spec that points at the ADR that retired it. Deleting it would leave a
reader of an old report with a code nothing explains.

**`E_OUTPUT_FILE_BLOCKED` is no longer fatal.** ADR 0025's test is whether a frame could exist
without the thing that is missing, and a folder where one artwork goes costs that file and
draws everything. The flag was `true` while nothing that weighs fatality ever saw the code;
now the job meets it on an artwork and passes its diagnostics to `fromPartial`, which would
have dropped the whole report for one held name — the defect ADR 0025 removed. The places
where the code costs more (the copied brief: the delivery is not opened) refuse through their
own `err` and never read the flag.

## Consequences

- An artwork held open by another program exits `2`; a folder at its name exits `1` with
  `E_OUTPUT_FILE_BLOCKED` and the folder's path. Both are pinned in `apps/cli/src/cli.test.ts`
  and the job's half in `packages/pipeline/src/job.test.ts`. A real lock cannot be taken from
  Node (it opens files sharing delete), so the tests stand in for it with a failure the
  adapter cannot explain, and the lock itself was measured by hand on Windows for the PR.
- A run that meets one unexplained rejection writes no report even though some artwork may
  already be in the folder. That is what exit `2` already promised ("`result.json` may be
  absent"), and a caller that retries gets the whole delivery with its report.
- `tyto watch` and the desktop queue acknowledge a task only when it succeeded, so a locked
  artwork leaves the task in the inbox to be tried again, as it did before. What changes is
  the record: `tyto watch` prints an internal failure instead of writing a `result.json`
  with `E_OUTPUT_WRITE`, and the desktop queue shows the run's `failure` text.

## Not decided here

**A read-only file at a delivery name exits `2`, and a retry never fixes it.** On Windows a
rename onto a read-only file is `EPERM`, the same answer a lock gives, and `placeAtomic`
decides by looking: a file at the name is treated as a lock. On POSIX the rename replaces the
file and the write succeeds. Telling the two apart on Windows means reading the file's
attributes after the failure, which is the same "look, don't read the code" approach and a
separate card.

## References

- ADR 0011 — the boundary with Jacurutu, and the two non-zero exit codes.
- ADR 0025 — a stage may produce a value and still report errors; what fatal means.
- TYTO-129, TYTO-243 — the delivery files' half of the same rule.
- `docs/render-contract.md` — the exit-code table this keeps true.
