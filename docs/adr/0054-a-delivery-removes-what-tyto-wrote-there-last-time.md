# 0054 — A delivery removes what Tyto wrote there last time, and nothing else

Status: accepted · 2026-09-28 · TYTO-127 · amends TYTO-121's "an existing folder is written into and not cleared"

## Context

`tyto render --folder` (TYTO-121) and the desktop's export box write into a folder a person
picked and will send as it is. Both reused an existing folder and overwrote by name, so a file
an earlier export wrote and this one did not survived, and `result.json` did not mention it.
Measured on 2026-09-28 with `carrossel-lista`: exported with four artworks and then with three
into one `--folder` delivery, the folder held 8 artwork files and `result.json` listed 6.
ADR 0053 made the same thing happen once to every existing delivery: the agenda exported by
the previous build and then by the new one left `lamina-1-grid.png` and `lamina-2-grid.png`
beside `grid-01.png` and `grid-02.png`.

TYTO-127 listed four answers: clear the folder, refuse a non-empty one, write a manifest and
leave the rest, or leave it and document it louder. Clearing deletes files a person put there;
refusing turns every second export into two steps; the manifest already exists and does not
stop the stale artwork from being delivered; and leaving it fails the card. The maintainer
chose a fifth on 2026-09-28: "sim, pode apagar com aviso".

## Decision

**Before an export writes anything, it reads the folder's previous `result.json`. After the
artwork is written and before the new `result.json` replaces it, it removes each file that
report listed and this export did not produce.** A file the previous report did not list is
never touched, whatever it is called. Every file removed is a `W_LEFTOVER_REMOVED` warning, and
every listed file that could have been removed and was not is a `W_LEFTOVER_KEPT` with the
reason, both in the new `result.json` and on stderr.

A listed file is kept when:

- **its size is not the `bytes` the previous report recorded.** Somebody replaced it by hand
  under the same name, and it is theirs now;
- **its name is not a single file name in the artwork folder**: a separator of either
  platform, an absolute path, a `:`, `.` or `..`, or the report itself. Refused, not
  normalised, because a hand-edited report is text anybody can write;
- **the export did not finish**: it was cancelled, it reported an error, or it wrote fewer
  files than it planned. The older file may be the only copy of that artwork there is;
- **the operating system refuses the removal**, which is Windows with the file open
  somewhere. The export itself succeeded, so it is a warning and not a failure;
- it is not a plain file.

A previous report that cannot be read or parsed removes nothing and is one
`W_PREVIOUS_RESULT_UNREADABLE`. No previous report is the ordinary first export and says
nothing. The report is read leniently, only `artifacts[].name` and `bytes`, so a report written
by an older or a newer Tyto still counts as a record of which files are Tyto's.

**Where it applies:** `tyto render --folder`, and the desktop's export box, through a
construction option on `fsTaskOutput`. **Where it does not:** `tyto render --out`, `tyto watch`
and the desktop's queue panel, whose `out/` folder is the ADR 0011 contract. Its reader,
Jacurutu, reconciles against `result.json` itself, and nothing about that folder changes.

## Consequences

The shrinking carousel and the rename upgrade both leave a folder holding exactly what the
last export wrote, plus whatever a person added. Measured after this change: the four-to-three
carousel removes `grid-1x1-04.svg` and `story-04.svg` with two warnings, a `leia-me.txt` put in
the folder survives, and the agenda exported by the pre-ADR 0053 build and then by this one
ends with `grid-01.png` and `grid-02.png` only.

What it does not cover, stated rather than left to be found:

- A folder that holds leftovers and no `result.json` keeps them. Nothing records that they
  are Tyto's.
- A file kept for any of the reasons above is not listed in the new `result.json`, which lists
  what this export wrote. The warning is the last record of it, and the next export will not
  know about it.
- The queue panel's _Try again_ into `outbox/<id>/out/` can still leave a leftover, by the
  contract's rule. It is a card of its own.
