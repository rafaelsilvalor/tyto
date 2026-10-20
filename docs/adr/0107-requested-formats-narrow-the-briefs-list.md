# 0107 — Requested formats narrow the brief's list

Status: accepted · 2026-10-20 · TYTO-332

## Context

`resolve` took a run's formats (`--formats` on the CLI, the Export dialog's ticks on the
desktop) only when the brief's frontmatter listed none. That was `--template`'s rule copied
over: what the brief says about itself wins over what one run says about it.

The desktop broke it in practice. The Export dialog offers a checkbox per format of the
template, and the desktop sends the ticked ones as `formats`. On a brief with
`formats: [grid, story]`, unticking **Story** still planned 18 of 24 artworks and wrote
`story-01..03` next to `grid` (measured by the TYTO-317 executor on e3d32e9). The dialog
offered a choice the pipeline then overrode, and the manual had to carry a warning box and a
troubleshooting entry saying so.

## Decision

**A run's formats narrow the brief's list; they never widen it.** In `formatsOf`
(`packages/core/src/brief/resolve.ts`):

- The brief's list is read by `listedFormats` (a scalar is a list of one) and checked
  against the manifest: a format the template does not render is `E_UNKNOWN_FORMAT` with the
  frontmatter line's range, as before.
- With formats from the run as well, the result is the brief's formats that the run also
  names, **in the brief's order**. A run format the template does not render is
  `E_UNKNOWN_FORMAT` with no range, as before. A run format the template renders but the
  brief does not list is the new **`E_FORMAT_NOT_IN_BRIEF`**: an error, not fatal, with the
  range of the frontmatter's `formats` line, because that line is where the fix goes.
- With no list in the brief, nothing changes: the run's formats are used as they are, and
  without them every format the template renders.

The desktop's Export dialog offers only the brief's formats when the frontmatter lists some
(`offeredFormats` in `apps/desktop/src/renderer/frontmatter.ts`, which reads the line with
`parseBrief` and the same `listedFormats`). Ticking all of them still sends no `formats`, so
"open the dialog and click Export" is the same request as before; unticking one sends the
subset, which now narrows.

**`--template` stays a fallback.** A template is one choice: there is nothing to narrow, and
a flag that replaced the brief's template would render a brief against slots it was not
written for. `formats` is a set, and wanting part of it for one run is an ordinary request.
The two flags now have different rules because they describe different things.

## Consequences

- **The CLI contract changes.** `tyto render` and `tyto watch` with `--formats` on a brief
  that lists formats used to ignore the flag; now they narrow to it. `watch --formats story`
  on a brief that does not list `story` reports `E_FORMAT_NOT_IN_BRIEF` and renders nothing
  for it — intended: a run asking for a size the brief left out is told so instead of being
  silently given something else. `docs/render-contract.md` and the manual's CLI reference say
  so.
- A caller cannot add a format to a brief from outside it. To render one the brief does not
  list, edit the brief's `formats:` line — the same place the fix for every other
  frontmatter question goes.
- Callers that pass no formats (queue, preview, template editor, editor analysis, plugins)
  are unaffected.
- The manual's warning box on the Export page and the troubleshooting entry for TYTO-332 are
  removed in both editions.
