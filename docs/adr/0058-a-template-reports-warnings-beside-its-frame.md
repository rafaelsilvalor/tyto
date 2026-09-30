# 0058 — A template reports warnings beside its frame

Status: accepted · 2026-09-30 · TYTO-202 · extends ADR 0013's warnings on the ok branch and ADR
0048's isolated code templates

## Context

One `::lamina` feeds every format a brief asks for. On the weekly mock-exam agenda (TYTO-200) a
slide that fits the 1080×1920 story can run off the foot of the 1080×1350 grid, and the part
below the frame is cut. Nothing said so: a template's build returned a `Frame` and nothing else,
so the only code that knew where the content ended had no way to tell the author. The example
briefs and the brief-modeller skill carried a written rule instead — "a slide must fit the
grid".

`W_TEXT_OVERFLOW` does not cover it. It is raised by `compile` for one text node whose runs do
not fit that node's own box. A slide whose every box holds its text can still be taller than
the page: the boxes are fine, and the layout that stacked them is what ran over.

An installed code template runs in its plugin's process (ADR 0048). Whatever a template says
has to cross that boundary as data — a thread's structured clone or the desktop's JSON wire,
where `undefined` does not survive — and what crosses from a plugin is untrusted.

## Decision

**`TemplateContext` gains `report(report)`, and a template reports through it while it
builds.** `build` still returns a `Frame`, so no template that does not report changes.

**A report is one of a closed list, `TemplateReport`, and carries only the template's own
numbers.** The first and only entry is `{ code: 'W_TEMPLATE_OVERFLOW', overflow }`, in px.
The template does not write a message, a severity or a range.

**`compile` turns a report into the catalog's diagnostic.** It fills in the artwork id and the
format, and puts the range of the directive the artwork came from — the `::lamina` — on it.
Severity and wording live in `packages/core/src/diagnostics/codes.ts`, like every other
diagnostic, so `docs/diagnostic-codes.md` publishes it and the CLI, `result.json` and the
desktop show it the way they show any warning. The diagnostic rides the ok branch (ADR 0013):
the frame is still drawn and still written.

**Across the isolation boundary, the reports cross back beside the frame.** The guest rebuilds
`report` per call, as it rebuilds `measure`, and the `template-pack` point's `build` answers
`ok({ frame, reports })`. `reports` is always a list, never absent, because the answer may cross
as JSON. The host checks it against a zod schema of the closed list; a plugin that reports a
code outside it gets `E_PLUGIN_PROTOCOL` for that frame, so a plugin cannot put an error, a
message or somebody else's code into the author's run. `installedTemplateSource` hands each
report that passed to the host context's `report`, so `compileDeferred` writes the diagnostic
the same way `compile` does. `IsolatedPackBuild` answers `Result<TemplateAnswer, Diagnostics>`.

**The overflow check belongs to the layout.** `reportOverflow(report, bottom, limit)` in
`@tyto/template-kit` reports when the lowest thing drawn ends below the page; the simulados
composition calls it with the sign-off's foot and the page height left above the seal.

## Consequences

A slide that runs off the grid now renders with `W_TEMPLATE_OVERFLOW` naming the artwork, the
format and how far — `tyto render` prints it on stderr and exits 0, because a warning is not a
failure. The same slide on the story, where it fits, says nothing.

Adding a code a template may report is three edits in one place's neighbourhood: the catalog
entry, the `TemplateReport` union with `templateReportCodes`, and the wire schema in
`plugin-api`'s `points.ts`. That is deliberate: every code a plugin may raise is one somebody
chose to let it raise.

A context built by hand — a test, the markup check in `template-lang` — passes `reportNothing`,
as it passes `measureNothing`.

Not done: a markup template cannot report, since the markup language has no statement for it;
and Tyto warns about an overflowing slide but does not move its content to another slide.
