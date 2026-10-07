# 0068 — Inline SVG markup is a closed subset, checked once in `core`

Status: accepted · 2026-10-07 · TYTO-168 · extends ADR 0018 (what an exporter may assume about
the IR) and applies ADR 0007 (third-party code is untrusted) to the markup it hands over

## Context

A `Vector` of kind `svg` carries a whole SVG file as a string, and both exporters inline it into
the document they write. The schema said the markup was "expected to be sanitized before it
reaches the IR", and `export-html` inlined it "as it stands" on the same assumption. Nobody
sanitised it. The precondition had no enforcer anywhere in the pipeline.

The cheap half of the problem was measured on two asset files handed over for the Agenda
template on 2026-09-22, both from the same illustration tool: each declares `.cls-1` in a
`<style>` block, with different fills. Illustrator and Figma number exported classes from
`.cls-1` every time, so two files in one artwork collide by arithmetic, and the first repaints
the second. An `id` collides the same way: `url(#gradient)` in one icon can paint with the
other's gradient. The expensive half is that a file can carry script, event handlers and
references to the network, and the card that found this called that future. It is not: since
TYTO-50 and TYTO-189 an installed plugin contributes templates, code templates included, and a
code template calls `vector()` with any string it likes — read from its own folder through
`context.files.svg` (ADR 0062) or written inline.

Three shapes were on the table:

- **Sanitise on the way in**, in `template-lang` and in the SDK's `vector()`. Closest to the
  author, but a code template's string reaches the scene without passing through either.
- **Sanitise in the exporters.** The last gate, but two rewriters — prefix the ids, scope the
  CSS — are two answers, the failure `packages/pipeline/src/artifact.ts` already declined for
  its own sanitising.
- **Refuse** anything but a narrow subset, and send the rest to `kind: 'path'` or to an image.
  The Agenda work had reached the same place independently: flat geometry belongs in a `d`,
  illustrations belong in a PNG.

## Decision

**The markup is refused, not sanitised, unless it is flat geometry.** One pure function in
`core`, `checkSvgMarkup`, reads the string with a tokenizer that has to account for every
character and answers the first construct outside the subset, as a phrase an author can act on.
The subset is:

- **Elements:** `svg` as the one root, `g`, `path`, `rect`, `circle`, `ellipse`, `line`,
  `polyline`, `polygon`, and `title` and `desc` with text.
- **Attributes:** geometry (`d`, `x`, `cx`, `points`, `transform`…), the presentation
  attributes that paint it (`fill`, `stroke*`, `opacity`, `fill-rule`…), the root's `viewBox`,
  size and `preserveAspectRatio`, and namespace declarations.
- **Around them:** a leading `<?xml?>` declaration, comments, a byte order mark, and the five
  XML entities plus numeric references.

**Nothing that names anything, and nothing that can be named.** `<style>`, `class`, `id`,
`<defs>`, gradients, `<use>`, `<image>`, `<text>`, `<foreignObject>`, `<script>`, `on*`
handlers, `url()` and `javascript:` in any value, inline `style`, DOCTYPE, CDATA, unknown
entities and unquoted values are all outside it. Inline `style` is refused because on the root
it can position the file anywhere on the page; an unquoted value because an HTML parser and an
XML parser can read one differently. A file that passes is inlined verbatim, so what was checked
is what is written.

**The check runs in four places, and it is the same function in all four:**

1. **`parseScene`**, as a scene invariant, `E_SCENE_SVG_MARKUP`, fatal like every other broken
   invariant and naming the node. Every scene passes through it on its way to an exporter —
   markup templates, built-ins, and an installed plugin's code template alike — so this is
   where the guarantee is made.
2. **`template-lang`'s static check**, as `E_TEMPLATE_MARKUP` on the `src` attribute's range,
   before any brief is written. A literal `src` is the template's own file, so the template is
   what is wrong and the author fixes it where they named it. An interpolated `src` is only
   known per brief and is left to `parseScene`.
3. **`export-html`** and **4. `export-svg`**, before they inline, for a scene built some other
   way than through `parseScene`. Each answers `E_EXPORT_UNSUPPORTED`, and the node keeps its
   box and draws nothing. That is the one exception to ADR 0035's "leave the node visible":
   drawing this markup is the harm the check exists to prevent. `export-html`'s mask path
   (`svg-shapes.ts`) runs it too.

**Every refusal names the way out:** re-export from Illustrator with Styling set to
Presentation Attributes, draw the shape as a contour (`kind: 'path'`), or place an
illustration as a PNG. The sentence is one constant in `core`, `SVG_MARKUP_WAY_OUT`, so the
four refusals say it alike.

## Consequences

**This removes something an author could do before.** A `<vector src>`, or a code template's
`vector()`, whose file carries a stylesheet, classes, gradients, ids, text, images or filters
used to render, with the collision, and is now an error. Rafael decided that on 2026-10-07. In
this repository the cost was zero templates: the three that use `<vector src>` (two `cartaz`
fixtures and `template-lang`'s documentation example) draw one flat path each, and no built-in
uses inline markup. Templates outside the repository were not measured.

An exporter may now assume that the markup of every `Vector.svg` it receives from `parseScene`
is flat geometry that cannot reach another node. ADR 0018 lists what an exporter does where the
IR left a question open; this answers one more, by closing it in the IR.

A gradient or a pattern on an inline file is gone with the `id` it needed. The node's own
`fill` and `stroke` still inherit into the file as before, and a gradient there was already
reported as approximated, so a coloured icon is written as presentation attributes or as a
`path` with the node's paint.

Rewriting the markup — prefixing ids, scoping CSS — stays possible later, as a new ADR, if a
real template needs a gradient inside an inline file. It would replace the refusal of those
constructs, not add a second reader beside this one.

The isolation of a plugin's template code is a different layer of the same concern (E7). This
ADR covers what that code may hand over, not what it may run.
