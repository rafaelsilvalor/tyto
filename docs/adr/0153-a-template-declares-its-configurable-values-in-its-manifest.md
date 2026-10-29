# 0153 — A template declares its configurable values in its manifest

Status: accepted · 2026-10-29 · TYTO-438 · builds on ADR 0047, ADR 0048, ADR 0058, ADR 0062,
ADR 0149 and ADR 0151

## Context

ADR 0151 decision 1 says a configuration changes a value and never the composition, that only
what a template declares is configurable, and that the declaration lives in the manifest, read
and never run. It leaves the shape to TYTO-438.

Read in the code at `origin/main` 6a5176d9:

- **Every such value is a constant in code.** The one-image table
  (`packages/house-style/src/table.ts`) imports its paper, ink, zebra, title gap, size limits
  and optical drop from `table-tokens.ts` (ADR 0047). Nothing outside the template can change
  them.
- **`TemplateContext` is built by hand in 29 files**, tests in seven packages and in
  `apps/cli` among them. A new required field would break each one, and every template
  repository's tests that do the same, against a published `@tyto/core`.
- **The call to a template in its plugin's process is checked by a strict schema**
  (`templateCallSchema` in `packages/plugin-api/src/isolation/points.ts`) at
  `RPC_PROTOCOL_VERSION` 9. A field the host adds to it is refused by a guest that does not know
  it, so carrying values across is a protocol change and, by ADR 0149 point 4, a breaking
  release of `@tyto/plugin-api`.

## Decision

1. **The manifest gains an optional `values` record**, by name, each entry one of five kinds:

   ```yaml
   values:
     title-gap: { type: length, default: 20, min: 0, max: 120 } # px
     optical-drop: { type: number, default: 0.15, min: 0, max: 0.4 }
     paper: { type: color, default: '#fbfbfb' }
     title-face: { type: face, default: { family: Inter, weight: 700 } }
     badge: { type: image, default: assets/badge.png } # in the template's folder
   ```

   `length` is in px and `number` is unitless; only these two take `min` and `max`. A default
   outside its own limits, a `min` above its `max`, a colour that is not hex and limits on any
   other kind are refused while the manifest is read, at the key (`E_MANIFEST_SHAPE`). A name
   follows the slot rule. An image's default is optional: a template may declare an image it
   draws only when somebody supplies one. The field is optional, so every manifest written
   before it loads unchanged, and **the default is the constant the template held before**, so
   a template that declares values draws the same bytes when nothing configures it.

2. **`compile` resolves the values once per compile and hands them as `context.values`**:
   each default, an image's as the ref its template folder answers, overlaid by
   `CompileOptions.values`, which a caller supplies with the range each was written at. Nothing
   supplies them from a plugin file yet; that is TYTO-439.

3. **A supplied value the template cannot take is a warning, and the default stands.**
   `W_TEMPLATE_VALUE_UNKNOWN` for a name the template did not declare,
   `W_TEMPLATE_VALUE_INVALID` for the wrong kind or a number outside its limits, each at the
   supplied range. ADR 0151 decision 2 makes a plugin file tolerant per entry, and a value is
   the smallest entry there is: one bad colour does not cost the person the artwork. A length
   is accepted as `20` or `'20px'`, since a plugin file is written by people.

4. **`context.values` is optional, and a template reads it with a fallback.**
   `numberValue(context, name, fallback)`, `colorValue`, `faceValue` and `imageValue` in
   `@tyto/core/template` answer the resolved value, or the template's own constant when the
   context has none or the value is of another kind. `compile` always sets it. A test pins each
   declared default to that constant, so both paths draw the same; `tabela-roxo`'s pins its
   manifest to the house's `TABLE_VALUE_DEFAULTS`.

5. **Values do not cross to a template in a plugin's process yet.** `TemplateCall` omits
   `values`, `compileDeferred` sends none, and the protocol stays at 9. A code template running
   in its plugin draws its fallbacks, which point 4 pins to its declared defaults. TYTO-439,
   which is what first supplies values from a file, adds `values` to the call and bumps the
   protocol, with the `@tyto/plugin-api` changeset ADR 0149 requires.

## Consequences

- `tabela-roxo` declares eleven values: `title-gap`, `title-floor`, `title-ceiling`,
  `body-floor`, `body-ceiling`, `optical-drop`, `paper`, `ink`, `zebra`, `on-accent` and
  `signature-ink`. **Not the accent**: it is the brand's, and TYTO-455 moves the brand's colours
  into its kit. The 38 snapshot files of TYTO-453 are unchanged.
- A template in its own repository declares the same `values` in its `manifest.yaml` once it
  depends on a `@tyto/core` that has them. A Tyto released before this one refuses that manifest
  at load, because the schema is strict, so the repository moves its `engine` range with the
  dependency (`docs/plugin-authoring.md`).
- `compileTemplate` (ADR 0152) takes `values`, so a template's repository tests what it
  declares.
- Cross-value rules, such as a title floor above its ceiling, are not checked: the table
  survives them, and a rule between two values is a schema of its own nobody needs yet.

## Rejected

- **A required `context.values`.** It breaks every hand-built context, here and in template
  repositories, to save a fallback argument.
- **An error for a refused value.** It would fail a build over one colour in a plugin file,
  against ADR 0151's per-entry tolerance.
- **Filling the defaults in the plugin's process now**, from the manifests it registered. It
  needs the guest to keep them, and buys nothing until values cross, which TYTO-439 does with
  its protocol bump anyway.
- **The table's tokens moved into the manifest and deleted from code.** Other house templates
  may compose the table without declaring anything, and a token is still where ADR 0047 says a
  brand's number lives; the manifest names which of them a configuration may change.
