# 0014 — `color()` throws, and compile is where it stops

Status: accepted · 2026-09-07

## Context

`CLAUDE.md` fixes the stage signature at `Result<T, Diagnostic[]>` and forbids exceptions for expected errors; `result.ts` states the test that makes the rule operational — _nothing throws for an error a brief author can cause_. A bad hex literal is not that error. It is written in a `template.ts` or a `template.html`, which is code, and the honest reactions to one are to throw or to make every builder that touches a colour return a `Result`.

The second option, counted: 6 of the 8 exported functions in `packages/core/src/template/values.ts` change signature. `color`, `solid`, `stop` and `run` take a hex string; `linearGradient` and `radialGradient` are carried along by `AtLeastTwo<GradientStop>`. The node builders do not change, because they take a built `Paint` — which means the whole cost lands on the call site, where a template author writes nested expressions such as `fill: linearGradient(45, [stop(0, '#ff5900'), stop(1, '#ffbd00')])`. The fixture in `nodes.test.ts` has nine calls of that family, all inside one expression tree, and every one of them would have to be flattened into an unwrapped local. `template.ts` exists for ergonomics, beside the declarative `template.html` (ADR 0005); monadising it charges the cost in the wrong place.

Throwing for a programmer error is not new here either: `range()` throws `RangeError` for a negative offset, and `formatDiagnosticMessage` throws `TypeError` for a missing parameter.

## Decision

`color()` throws `TemplateError`, carrying a ready `E_TEMPLATE_VALUE` diagnostic. It is the only builder that throws, and the exception never leaves the compile stage: `compile` (E4.2) wraps the template call in a `try`/`catch` and returns `Err` with what it caught.

It catches everything, not only `TemplateError`. A template is third-party code — E11.4 plans a published template pack — so a `TypeError` inside someone else's template has to become a diagnostic rather than a crash in the desktop app or a stack trace on the CLI's stderr. A `TemplateError` contributes the diagnostic it already carries; anything else becomes `E_TEMPLATE_CRASH`, which this ADR adds to the catalog.

## Consequences

`compile` is the only `catch` in the pipeline. Removing it lets a bad literal escape as an exception, so its acceptance criteria test both branches: a template with a bad hex, and a template that throws something else.

A caught exception has no source `range`. `Diagnostic.range` is optional, so the diagnostic is not lying, but it points at no line. `template-lang` (E4.3) parses `color: #gggggg` inside a `<style>` block where the token _does_ have a range, and must either validate the token before it reaches `color()` or reattach the range to the diagnostic the error carries. E4.3 owns that; the SDK does not grow a `Result`-returning twin of `color()` for it.

`E_TEMPLATE_CRASH` reports a bug rather than an authoring mistake, so its message names the template and quotes what was thrown instead of offering advice the template author cannot act on from a brief.

Any future extension point that parses colour outside a compile stage inherits the same obligation: catch at the boundary. The SDK stays callable from a plugin without ceremony, and the plugin host is where the ceremony goes.
