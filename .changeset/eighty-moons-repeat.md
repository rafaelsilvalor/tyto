---
'@tyto/core': patch
---

Close three loose ends left open by E3.3 and E4.1 (E4.7).

`min` and `max` are now refused where they would count nothing. They mean occurrences on a
repeatable slot and characters on every other one, and only `rich-text` has characters — so
`{ type: image, max: 60 }` is `E_MANIFEST_SHAPE` at `slots.<name>.max` instead of a cap that
silently never fires. Adding `repeat: true` makes the same pair meaningful again for any
type.

A repeat count below `min` now carries a range. There is no occurrence to point at when the
brief wrote none, so it falls back to the span `E_MISSING_REQUIRED_SLOT` already uses rather
than arriving somewhere an editor cannot draw it. Too _many_ is unchanged: the first
occurrence over the limit is right there and still takes the blame.

`IDENTIFIER` in `template/manifest.ts` is the grammar's `identifier` token written a second
time — `brief-lang` depends on `core`, so it cannot be imported from where it belongs. A new
check in `tools/repo-checks` translates the token into a regex and compares the two, so
moving one without the other fails `pnpm check` instead of drifting in silence.
