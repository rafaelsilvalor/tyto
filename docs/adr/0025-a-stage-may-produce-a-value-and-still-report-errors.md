# 0025 — A stage may produce a value and still report errors

Status: accepted · proposed 2026-09-16, accepted 2026-09-17 · TYTO-107 · extends ADR 0013

## Context

A brief with one error anywhere renders nothing. Typing a stray character while writing makes
the whole preview go empty, at the one moment the preview is what tells the author whether the
fix worked. TYTO-108 made that less painful — the last good artwork stays on screen, marked as
older than the text — but it is still yesterday's picture. TYTO-107 asks for the expensive and
more correct answer: **render the slots that are fine and discard only the broken one.**

### The parser already builds what would be needed

`packages/brief-lang/src/parse-brief.ts`:

```
302   for (const child of children(top)) {     ← builds frontmatter + every directive
312   if (diagnostics.length > 0) return err(sortDiagnostics(diagnostics));
314   return ok({ frontmatter, directives, range: rangeOf(top) });
```

Lezer recovers from a broken line by marking that span as an error node and carrying on, so
`directives` holds the good ones. The complete AST exists at line 310 and is thrown away at 312. Nothing about partial output needs a new parser.

Note what line 312 actually says: it fails on `diagnostics.length > 0`, not on
`hasErrors(diagnostics)`. **A warning fails this stage today**, which is already narrower
than ADR 0013 describes.

### Why this cannot simply be done

Two mechanisms make "a value and an error at the same time" unrepresentable.

**Severity is a property of the code, not of the occurrence.** `diagnostic()` reads it out of
the catalogue — `severity: diagnosticCodes[code].severity` — so `E_SYNTAX` is an error whether
it is in the frontmatter, where it means the template binding cannot be read, or in the body,
where it means one directive out of twenty is unreadable. One code, two situations that differ
in exactly the way this card is about.

**`Ok<T>` has one channel and it is named for warnings.** ADR 0013 fixed `Ok<T>` as
`{ ok, value, warnings }` and `fromDiagnostics` as _"failing when any item has severity error
and otherwise passing the whole list through as warnings"_. There is no way for a stage to
return a partial value and say "and these are errors" without either relabelling the errors or
changing what the ok branch carries.

### What the second option would cost, counted

```
reads of `.warnings`, outside tests        38   in 10 files
reads of `.warnings`, in tests             39
files using `fromDiagnostics`               9   including both exporters and 3 pure packages
`Ok<T>` is public                               packages/core/src/index.ts
early returns in the desktop preview        5   apps/desktop/src/main/preview.ts
early returns in the pipeline job           7   packages/pipeline/src/job.ts
```

The twelve early returns are the second half of the work and are not addressed by either
shape below: a stage that _can_ answer partially is useless while its caller still aborts on
the first failure.

## Decision

**The recommended shape, accepted by the maintainer on 2026-09-17** and built in the same
card. The two alternatives below are kept as the record of what was weighed; _What the
building corrected_ at the end is what the proposal got wrong.

### Recommended: separate the two axes, because they are two things

**Severity says how bad it is for the author. Fatality says whether a value survives.** Today
one field carries both, and that conflation is the whole of why this is hard.

- `DiagnosticCodeDefinition` gains `fatal: boolean` beside `severity`.
- A stage partitions its diagnostics: fatal ones go to `err`, the rest ride with the value.
- `Ok<T>.warnings` becomes `Ok<T>.diagnostics`, because it would no longer hold only
  warnings. `hasErrors(result.diagnostics)` is what the CLI's exit code and `result.json`'s
  `status` read — so a partly rendered brief **fails the build** while still writing its
  artifacts, which is the honest answer for CI.

ADR 0013 is extended rather than overturned: warnings still travel on the ok branch, and so
now do non-fatal errors. `fromDiagnostics` keeps its meaning for the stages that have no
partial value to offer, which is most of them.

### Alternative A — relabel the non-fatal errors as warnings

Cheapest by far: new `W_*` codes for the skippable cases, no change to `core`, ADR 0013
untouched. **Rejected**, and the reason is the CLI rather than taste: a warning does not fail
a build, so `tyto render` would exit 0 on a brief that rendered with a required slot missing.
The card's own argument against partial rendering is that _"it shows art that looks finished
with a slot silently empty, and somebody in a hurry exports it"_ — and this shape makes that
the default in CI, where nobody is looking at all.

It also says something false. A directive the parser could not read is an error the author
has to fix; calling it a warning to make the plumbing work is the plumbing deciding the
vocabulary.

### Alternative B — leave it, and let TYTO-108 be the answer

The last good artwork stays on screen, marked. It is never a lie: _"this is the last version
that worked"_ is true, and _"here is your art, minus the broken part"_ can mislead. **Not
rejected outright** — it is the cheap answer already shipped, and if the trigger on TYTO-107
never fires, this is what it was waiting for.

The cost of choosing it is that the CLI keeps rendering nothing for a brief with one bad
slot, which no marker helps: there is no preview in CI.

## The fatal list, which TYTO-107 asks for either way

Fatal means **nothing can be drawn** — not "serious". The test is whether a frame could exist
without the thing that is missing.

| Code                                                                                                                                  | Fatal  | Why                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E_SYNTAX` **in the frontmatter**                                                                                                     | yes    | The template binding cannot be read, so there is nothing to render against. Needs the code split from the body case — see below.                                                                        |
| `E_NO_TEMPLATE`                                                                                                                       | yes    | Same, one step later.                                                                                                                                                                                   |
| `E_UNKNOWN_TEMPLATE`                                                                                                                  | yes    | Same.                                                                                                                                                                                                   |
| `E_FORMATS_READ` · `E_FORMATS_SYNTAX` · `E_FORMATS_SHAPE`                                                                             | yes    | No format means no frame has a size.                                                                                                                                                                    |
| `E_UNSUPPORTED_CSS` · `E_UNSUPPORTED_TAG` · `E_UNSUPPORTED_ATTRIBUTE` · `E_TEMPLATE_MARKUP` · `E_TEMPLATE_VALUE` · `E_TEMPLATE_CRASH` | yes    | The template is what every artwork is drawn through. A broken one breaks all of them, not one slot.                                                                                                     |
| `E_SCENE_*` (six codes)                                                                                                               | yes    | The IR is malformed; the exporter has nothing it can draw.                                                                                                                                              |
| `E_PERMISSION` · `E_PLUGIN_MANIFEST_*`                                                                                                | yes    | A plugin that did not load did not contribute a slot to skip.                                                                                                                                           |
| `E_SYNTAX` **in the body**                                                                                                            | **no** | One directive is unreadable and the others are already in the AST.                                                                                                                                      |
| `E_UNKNOWN_SLOT` · `E_UNKNOWN_DIRECTIVE`                                                                                              | no     | The slot does not exist; the ones that do are unaffected.                                                                                                                                               |
| `E_BAD_SLOT_VALUE` · `E_BAD_ADJUSTMENT`                                                                                               | no     | One slot's value or one adjustment.                                                                                                                                                                     |
| `E_MISSING_REQUIRED_SLOT`                                                                                                             | no     | **The dangerous one.** The artwork renders with a hole where the manifest promised content, which is precisely the "looks finished" failure. It is non-fatal only if the gap is visible in the artwork. |
| `E_ASSET_NOT_FOUND`                                                                                                                   | no     | One image.                                                                                                                                                                                              |
| `E_UNKNOWN_FORMAT`                                                                                                                    | no     | The other formats still render.                                                                                                                                                                         |

**`E_SYNTAX` has to be split**, because severity and now fatality are both properties of the
code and one code cannot be fatal in one place and not in another. The frontmatter case gets
its own — `E_FRONTMATTER_SYNTAX` reads well beside `E_FORMATS_SYNTAX`, which is the same idea
one file over.

## Consequences

**The gap has to be visible in the artwork, not only in the problems panel.** This is the
acceptance criterion that is a feature rather than a policy: a missing required slot must draw
as something, and what that something is — a placeholder node in the IR, a marker the exporter
adds — is an open question this ADR does not answer. Until it has an answer,
`E_MISSING_REQUIRED_SLOT` stays fatal, whatever the table above says.

> **Answered by ADR 0035** (TYTO-116), which is both: a `Rect` stamp `compile` puts on the
> frame, and a crossed box the exporters draw in the box of a node they could not fill. The
> three codes held fatal by this paragraph — `E_MISSING_REQUIRED_SLOT`,
> `E_EXPORT_ASSET_UNRESOLVED` and `E_EXPORT_UNSUPPORTED` — are non-fatal from that card on.
> It also found that flipping the field would not have been enough on its own: the two
> exporters still weighed diagnostics with `fromDiagnostics`, which reads severity, so they
> now call `fromPartial` like every stage this ADR converted.

**Twelve early returns become decisions.** Each of the five in the desktop preview and seven in
the pipeline job currently reads "if this failed, stop". Each has to become "if this failed
_fatally_, stop", and a caller that forgets is a stage answering partially into a consumer that
throws it away.

**`result.json` gains a third state to describe**, and `docs/contracts.md` has to say what it
is: rendered, with errors. The schema already carries `diagnostics[]` beside `status`, so the
shape exists; what it means does not.

**Every `Ok` literal in the repository keeps compiling.** Renaming `warnings` to `diagnostics`
is a type error at every read — 38 outside tests and 39 in them — which is the good kind: the
compiler names each place that has to decide whether it meant "warnings" or "everything that
was wrong".

## What this ADR deliberately does not decide

Whether TYTO-107 is worth doing. Its own `When:` is a trigger that has not fired — _"when a
real brief spends perceptible time being corrected with the preview marked stale"_ — and
TYTO-108, which creates that marker, shipped hours before this was written. The recommendation
here is what to build **if** it is built, not a case for building it now.

## What the building corrected

Written after the code, because a proposal that is never checked against its own
implementation is a doc that ages without anybody noticing.

**`E_SYNTAX` had to split three ways, not two.** `packages/template-lang` reports the same
code for a `template.html` that does not parse, and a broken template breaks every artwork
drawn through it. One code cannot be fatal in one place and not in another — the argument
this ADR makes for the frontmatter — so there is an `E_TEMPLATE_SYNTAX` beside
`E_FRONTMATTER_SYNTAX`, and `E_SYNTAX` now means a line of the brief **body** and nothing
else.

**The frontmatter split needed no position test.** `Frontmatter` is one external token in
the Lezer grammar, so an error node can never be inside it: every `E_FRONTMATTER_SYNTAX`
comes from `frontmatter.ts` and every `E_SYNTAX` from the tree walk. The split is by which
file emits it, which is stronger than a range comparison and was not what this ADR expected.

**The twelve early returns did not become twelve decisions — none of them changed.** The
partition belongs to the stage, because the stage is the only side that knows what is left
of its value; by the time a caller reads `if (!result.ok)`, that already means _fatally_.
The five in the desktop preview and the seven in the pipeline job kept their conditions
exactly. What changed in `runJob` is its **last** line, which is not one of the twelve:
`problems.some(isError) ? err(problems) : …` became `fromPartial(report, problems)`.

That line was hiding a defect. `E_RENDER_FAILED` and `E_OUTPUT_WRITE` are one frame each and
the job draws the other eleven, so neither is fatal — and until this card the whole report
went into the `Err` with them, so `result.json` said `artifacts: []` over an output folder
the same run had already written nine files into. `packages/io`'s own test asserted the
files on disk and never the document that is supposed to describe them.

**The fatal list in this ADR was incomplete.** Eleven of the catalogue's codes were not in
the table: `E_FORMAT_NOT_DEFINED`, the four registry codes, `E_INPUT_READ`, the three
`E_EXPORT_*` and the two above. The generated `docs/diagnostic-codes.md` now carries every
one with its reason, which is where the list belongs — a table in an ADR is a snapshot, and
a field on the code cannot go stale.

Two of those eleven are fatal for the same reason `E_MISSING_REQUIRED_SLOT` is:
`E_EXPORT_ASSET_UNRESOLVED` and `E_EXPORT_UNSUPPORTED` would each leave a hole in the
artwork that nothing in the artwork names. "Non-fatal only if the gap is visible" is one
rule with three entries under it, not a special case for required slots.

**`docs/contracts.md` does not exist.** The contract is `docs/render-contract.md`, generated
from `tools/docs-gen/src/render-contract-doc.ts`, so the third state is written in the
generator. And it is a third _state_, not a third `status`: adding a value to that enum is
a documented break for every strict consumer, so "rendered, with errors" is `status: error`
read together with a non-empty `artifacts` — a table in the contract says so.

**The rename cost 76 lines in 25 files**, against the 77 reads in 19 counted above. The
compiler named every one, which is what the estimate said it would.
