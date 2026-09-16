# 0025 — A stage may produce a value and still report errors

Status: **proposed** · 2026-09-16 · TYTO-107 · extends ADR 0013

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

**Not taken. This ADR is the decision, written for the maintainer to accept or refuse**, and
TYTO-107 does not start until it is. What follows is the shape recommended and the two
alternatives, with what each costs.

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
