# 0066 — A brand kit's marks carry tones, and a kit may carry a wordmark

Status: accepted · 2026-10-04 · TYTO-230 · amends ADR 0063 (a plugin contributes a brand kit),
follows ADR 0065 (built-in templates draw placeholders without a kit), part of epic TYTO-222

## Context

ADR 0063's kit holds a logo as one `MarkShape` — one path, one colour chosen by the template —
and a signature. Removing the brand art from the banner backgrounds (TYTO-225, ADR 0065) showed
two things the kit could not carry: the logo painted on the backgrounds was in **two tones**,
and the square banner carried the brand's **wordmark** beside it. #301 measured both on the
backgrounds' pixels before painting them out: the tones' colours and where each sits, and the
wordmark's box in the square format (the table in `banner-roxo/template.ts`).

With the kit of ADR 0063, a real kit would draw a one-colour logo and no wordmark. The
maintainer decided (2026-10-04) that the art drawn with a real kit must match what the
backgrounds held, so the kit grows before the private kit (TYTO-226) fills it.

## Decision

### A mark may be toned layers

`BrandKit.logo` is a `BrandMark`: either the `MarkShape` of ADR 0063, or a `TonedMarkShape`,
`{ box, layers }`, where each layer is `{ tone, d, fillRule }` and `tone` is `primary` or
`secondary`. Layers are drawn in order, later over earlier, all in the one box.

**A tone is a role, not a colour.** "Geometry in, colour out" (`docs/template-conventions.md`)
still holds: a kit says which shape is the primary tone, and the template that places the mark
says which colour that is. The same kit can be two purples on one banner and one blue on
another layout.

**A one-shape mark stays valid and reads as all `primary`.** A kit written for ADR 0063 keeps
working with no change, and `primary` is defined as the colour a template drew a one-colour
logo in, so that kit draws exactly as before.

### A kit may carry a wordmark

`BrandKit.wordmark?` is a `BrandMark` under the same rules. A template that has room for one
draws it; the rest ignore it. **No template draws a stand-in for a missing wordmark**: no
layout needs its room held, and a stand-in would change the output of every template without
a kit, which ADR 0065 fixed.

### The bounds

A toned mark has 1 to 16 layers (`MARK_LAYER_LIMIT`), and **`MARK_PATH_LIMIT` bounds the sum
of its layers' paths**, not each one. The limit exists because the kit rides every call an
installed code template answers (ADR 0063); sixteen layers each at the limit would cost
sixteen times what a one-path mark may. A layer with any other key — a colour, say — or a tone
outside the two is refused at activation, as before.

### Built-in templates

The house reads every kit mark through `drawBrandMark` and `drawLogo` in `_casa/kit.ts`. A
one-shape mark still goes through template-kit's `mark()`, so the placeholder's nodes did not
move by a byte; a toned mark is a group of one vector per layer. `banner-roxo` maps `primary`
to the darker purple #301 measured and `secondary` to the lighter, and draws the wordmark in
the square format's measured box, as large as fits, from its left edge. The other places that
draw the logo use one ink, so both tones take it, which is what they drew before.

### The protocol is 4

`brandKitSchema` is strict and sits in `templateCallSchema` and in the `brand-kit`
registration. A guest bootstrap left on 3 would refuse a kit with a wordmark or layers with a
schema complaint — measured by removing `wordmark` from the schema, which turned the two
crossing tests red — so `RPC_PROTOCOL_VERSION` is **4**, as ADR 0063 made it 3, and a stale
bootstrap is refused by the handshake naming both numbers.

## Consequences

- A kit can carry a logo in two tones and a wordmark; TYTO-226 fills them with the real art.
- A template that reads `context.brand.logo` directly must handle both shapes; `isTonedMark`
  tells them apart. The built-in templates only read it through `_casa/kit.ts`.
- `@tyto/core` exports `BrandMark`, `TonedMarkShape`, `MarkLayer`, `MarkTone`, `isTonedMark`,
  `brandMarkSchema`, `tonedMarkSchema` and `MARK_LAYER_LIMIT`. Below 1.0 that is a minor bump
  (ADR 0040), as is the protocol number for `@tyto/plugin-api`.
- Without a kit, every built-in template's SVG and PNG output is byte-identical to ADR 0065's,
  measured by hashing all of them before and after (TYTO-230's pull request).
- Not decided: more than two tones. Two cover the art measured; a third is a new value in
  `MarkTone` and a colour in every template that maps tones, so it waits for a mark that needs
  it.
