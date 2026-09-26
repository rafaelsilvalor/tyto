# 0038 — A template measures text through its context, before it places it

Status: accepted · 2026-09-26 · TYTO-162 · extends ADR 0019

## Context

ADR 0019 put line breaking in the IR: `compile` measures every text node against the faces
and writes the breaks into its runs. It does that **after** the template has returned its
frame, two lines apart in one loop — `template.build(context)`, then
`layoutText(frame.children, faces, …)`. By the time anything is measured, every coordinate is
decided. A pill that wants to be as tall as the title inside it needs, while it is being
built, a number that does not exist yet.

The TypeScript route did not rescue it. `TemplateContext` carried `format`, `size`,
`idPrefix`, `artwork`, `slots` and `adjustments`, and none of them is the font cache;
`measureText` is pure and was reachable, but a template was not handed what it needs to call
it. And the measurement was never kept: `layoutText` changes the runs and nothing else, so no
box records how tall its text came out.

This is what stood between `agenda-semana` and the published artwork, whose pills wrap a long
title or professor onto a second line and grow with it — the maintainer's description on
2026-09-23 — and what TYTO-161's hug is waiting for.

## Decision

### A measuring function on the context

`TemplateContext.measure(node)` answers with the `TextMeasurement` — laid-out runs, `lines`,
`width`, `height`, `scale`, `overflow` — for a text node the template has built and not yet
placed. It is `measureText(node, faces)` over the compile's own font cache, one closure per
compile, so what a template is told and what `layoutText` does afterwards are **the same
function over the same faces**: the same text cannot come out at two heights in one render.
`measureText` now takes a node without an id (`MeasurableText`), because a template measures
the draft `text()` returns and `frame()` assigns ids later.

It is required on the type. A context built by hand — the markup static check, a template's
own unit tests — passes `measureNothing` and says so, rather than leaving the field out and
letting a template read `undefined` for a reason nobody chose.

### "Cannot measure" is `undefined`, never zero

`faces` is optional in `compile`. Without it, and for a run whose face nobody supplied,
`measure` answers `undefined`. A measurement of text that really is small is a number. A
template that falls back to a guessed height on `undefined` does so knowingly.

### Rejected: a second pass

Build once to declare intent, measure, build again with the numbers. It is how a browser does
it, and it doubles the template calls per artwork and format on the path the editor runs on
every keystroke, for every template, whether or not any of them wanted a number. The function
costs a template that does not call it nothing.

## Consequences

Measured for the editor's recompile — `compile` of the maintainer's full week brief, four
slides, against the bundled substitute, 1 000 runs after 100 of warm-up, three alternating
rounds on one machine:

```
antes (main) r1: median 1.568 ms, p90 2.135 ms (n=1000)
depois (TYTO-162) r1: median 1.548 ms, p90 2.174 ms (n=1000)
antes (main) r2: median 1.488 ms, p90 1.971 ms (n=1000)
depois (TYTO-162) r2: median 1.626 ms, p90 2.227 ms (n=1000)
antes (main) r3: median 1.599 ms, p90 2.424 ms (n=1000)
depois (TYTO-162) r3: median 1.632 ms, p90 2.404 ms (n=1000)
```

The rounds of one build differ by as much as the two builds do. That measures the cost of the
field, not of using it: neither built-in template calls `measure` yet, and a template that
does pays one more layout of each node it asks about.

A markup template cannot call it. The markup language has no expressions to put a number in,
and giving it one is TYTO-161's question, not this one's. The IR is unchanged: it records what
the template asked for, and a measured height lives only in the template that asked.
