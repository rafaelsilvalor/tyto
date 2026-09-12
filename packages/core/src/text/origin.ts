import type { TextRun } from '../scene/nodes.js';
import type { SourceRange } from '../source/range.js';

/**
 * Where a run's text came from in the brief, for the diagnostics that have to point at it.
 *
 * The IR deliberately carries no source positions: a `Scene` is what an exporter consumes
 * and a template may build one out of nothing a brief wrote (`docs/ir-schema.md`). But
 * `W_TEXT_OVERFLOW` is about a **directive** — the author's answer to a slot — and telling
 * them "the text at artworks.0.frames.1.children.2 does not fit" is telling them nothing.
 *
 * So the link is kept beside the IR rather than inside it: a `WeakMap` from the run object
 * to the range of the inline that produced it, written by `runsOf` (the only path from a
 * brief's rich text to a run) and read by `compile`. Nothing outside `core` can see it, no
 * schema grew a field, and a scene that came from somewhere else simply has no entries —
 * which is the honest answer for a template that invented its own text.
 *
 * Weak because the map must not be what keeps a scene alive: entries disappear with the
 * runs they describe, and a long-running compile server does not accumulate briefs.
 */
const origins = new WeakMap<object, SourceRange>();

export function rememberOrigin(run: TextRun, range: SourceRange): void {
  origins.set(run, range);
}

/** Carries a run's origin onto the run that replaced it — layout rewrites run objects. */
export function inheritOrigin(from: TextRun, to: TextRun): void {
  const range = origins.get(from);
  if (range !== undefined) origins.set(to, range);
}

export function originOf(run: TextRun): SourceRange | undefined {
  return origins.get(run);
}
