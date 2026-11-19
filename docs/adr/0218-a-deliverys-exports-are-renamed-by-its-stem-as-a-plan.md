# 0218 — A delivery's exports are renamed by its stem, as a plan

Status: accepted · 2026-11-19 · TYTO-758 · builds on ADR 0129, ADR 0170, ADR 0201, ADR 0210 and
ADR 0215

## Context

TYTO-758 ships a delivery as one plan: the exports are renamed to the file names the team
delivers under, the folder is uploaded, the sheet and the tracker are written. A designer exports
from another program into the delivery's `exports` folder with whatever names that program gives
(`feed.png`, `Artboard 1.png`), and the record already says what the files are called: its
`stem` (ADR 0210), or a field a recipe declares (ADR 0213).

Two homes were weighed while planning the card, read in the code at `origin/main` a44baf08:

- **`to-delivery`**, which owns the record and the copy file it writes (ADR 0217). Its plan is
  one operation per row, a record write, and ADR 0217 decision 5 keeps everything but the record
  and its copy out of it. A rename is one write per file, and runs at ship time, not on every
  sync.
- **A sink of its own**, reading the rows `deliveries` gives. It plans and applies through the
  ports `to-delivery` already lends (ADR 0210), with one more.

The check (ADR 0215) already matches each image to the format it stands for, by pixel size, in
the record's order. The names follow the same matching, so a delivery's files are numbered in the
order its record lists them.

## Decision

1. **`rename-exports stem=<column> [digits=2] [path=<column>]` is a generic sink.** Its rows are
   deliveries: `path=` names the column holding each delivery's folder, `path` by default, as
   `deliveries` gives it (`record_path` after `with-deliveries`); `stem=` names the column
   holding each one's stem. `digits=` is 1 to 4.
2. **The names are core's** (`deliveryExportNames`): `<stem>-<n>.<extension>`, the extension in
   lower case, numbered from 1 in one sequence across the delivery. The images each format owes
   come first, by the check's matching, in the record's order of formats and by name within one;
   then every image no format took, by name. **An incomplete delivery is renamed too**: its
   extra or unreadable images take the numbers after the owed ones. A stem a file name cannot
   hold (the folder-name rules of ADR 0157 §4), an empty stem, or more images than the digits
   number refuse that delivery in the cell's note; the others still plan.
3. **One `rename` operation per file whose name changes**, `<folder>: feed.png → mca-1-01.png`. A
   file that already has its name has none, so a second run plans nothing. The images read are
   the check's: PNG and JPEG at the root of the exports folder, hidden files left out.
4. **Apply renames a delivery at a time, whole or not at all.** Before the first rename of a
   delivery, every file must hold the bytes the plan read (the digest `stat` answers) and every
   new name must be free or one of the files being renamed; otherwise each of its operations
   fails with the reason, nothing of it is renamed, and the other deliveries still run. When a
   new name is another file's old one (two files swap numbers), every file of the delivery takes
   a hidden name first (`.tyto-rename-<n>-<name>`, which listing and the check leave out), and a
   failure on that first step puts back what already moved.
5. **The port**: `ToDeliveryPorts.rename?(from, to)`, both paths relative to the workspace and
   confined as a write's are (ADR 0201, ADR 0112), never into `.tyto`, never in a restricted
   folder, and **never over another file**: a target that exists and is not the same file (by its
   identity, so a case-only rename on a file system that folds case goes through) is refused.
   The file takes the name asked for, case included. A host without `rename` refuses the step
   with `E_RECIPE_RENAME_EXPORTS`, as a missing argument or a restricted folder does.

## Consequences

- A ship recipe reads `deliveries`, keeps the ones to ship, and renames them before it uploads;
  the shown plan lists each file's new name.
- A delivery is never left half renamed by a file that moved since the plan. A rename that fails
  midway through a swap (the second step) leaves that file under its hidden name, named in the
  reason; the next run lists the folder without it until a person puts it back. That needs a
  file system failure between two renames of the same folder, and is said, not hidden.
- Within one run, a step below `rename-exports` that reads the folder sees the old names until
  the plan is applied. Planning later steps against the names a plan leaves is TYTO-758's next
  record (`apply together`).
