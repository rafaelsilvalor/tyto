# 0063 — A plugin contributes a brand kit, and a template reads its own brand's

Status: accepted · 2026-10-04 · TYTO-223 · extends ADR 0007 (built-in is a plugin), ADR 0020
(earlier source wins), ADR 0048 (an installed code template's context crosses without its
functions) and ADR 0052 (a manifest names its brand)

## Context

A template draws its brand's logo and signature where its layout puts them. Until this card
the art itself could only live beside the template, as a constant in its code or a file in
its folder, so whoever could read the template could read the art. The templates are meant
to stay readable while the art does not have to be (epic TYTO-222): a template should be
able to ask for its brand's logo and signature and draw a stand-in of its own choosing when
none is installed.

Nothing in `@tyto/plugin-api` let a plugin supply either. A `template-pack` contributes
templates, not something a template from another pack can read, and ADR 0062's
`context.files` reads the template's own folder, which is `noFiles` for a template running
in a plugin's process.

The manifest already names whose look a template draws (`brand`, ADR 0052), and nothing read
it.

## Decision

### A tenth extension point, `brand-kit`

`BrandKitContribution` is `{ id, brands }`, where `brands` maps a brand id, spelled as a
manifest's `brand`, to a `BrandKit`:

- `logo?: MarkShape` — `{ box, d, fillRule }`, the shape `@tyto/template-kit` already called
  `Mark`, and no colour. The fill is decided where the mark is placed ("geometry in, colour
  out", `docs/template-conventions.md`).
- `signature?: string` — the line a template prints as the brand's signature.

**The contribution is shaped like a template pack, and not keyed by the brand.** With
`id` = brand id, two plugins offering one brand would be the host's `E_PLUGIN_DUPLICATE`,
and `tryActivate` withdraws the second plugin whole — its templates, its exporters, all of
it — over one logo. The brand lives inside the kit instead, and kits merge as template names
do across sources:

- **Earlier wins** (ADR 0020). `PluginRegistry.brandKitsByBrand()` walks the contributions in
  registration order — built-ins first, then installed plugins in the order they were loaded —
  and the first plugin to offer a brand keeps it.
- **A shadowed kit is `W_BRAND_KIT_SHADOWED`**, naming the brand and both plugins, and it is
  not fatal. Nothing is wrong with the run; but "why is this not my logo" is the question the
  rule will generate, and one line in `result.json` answers it.

`MarkShape` and `BrandKit` are declared in `@tyto/core`, because `TemplateContext` carries a
kit. `@tyto/template-kit` re-exports the shape as `Mark` through a local alias, since tsup's
declaration build drops the `type` modifier of a re-export. `MarkShape` and not `Mark` in
core, because `@tyto/core` already exports the brief's `Mark`, an inline span.

### `TemplateContext.brand`, for the template's own brand

`TemplateContext` gains `brand: BrandKit`. `CompileOptions` and `JobPorts` gain
`brandKits?: ReadonlyMap<string, BrandKit>` — the merged map — and `compile` and
`compileDeferred` hand each template the kit under **its own manifest's `brand`**, and no
other. A template that names no brand, or whose brand nobody supplied, is handed `noBrandKit`,
an empty kit: **both fields `undefined`, never a missing object**, and the template decides
what stands in their place.

The whole map goes into `compile` rather than one kit, because which brand a template draws is
its manifest's to say, and a composition root that picked the kit itself would be a second
place deciding it.

### The kit is data, so it crosses with the call

A kit is geometry and a string. It crosses an isolated plugin's boundary as it is, in both
directions:

- **Registered by an installed plugin**, the whole contribution is data, checked by the host
  against a strict Zod schema before anything holds it (`ISOLATED_POINTS['brand-kit']`).
  A brand id a manifest could not name, a mark with any other key (a colour, say), a box of
  no size and a path past the limit below are refused at activation, as every malformed
  contribution is.
- **Handed to an installed code template** (ADR 0048), `brand` stays in `TemplateCall` — which
  omits only the functions, `measure`, `report` and `files` — and the guest hands it to the
  template's `build` as it arrived. It does not depend on reading the plugin's folder, so
  ADR 0062's `noFiles` does not touch it.

**A path is at most 65 536 characters** (`MARK_PATH_LIMIT`) and a signature at most 500
(`SIGNATURE_LIMIT`). A kit rides every call an installed code template answers, so a path of
any length would be paid for on every frame; 64 Ki characters holds a detailed logo with room
to spare. Past it the contribution is refused, never cut, because a truncated path draws a
different shape with no diagnostic.

### The protocol is 3

`templateCallSchema` is strict and gains a required `brand`. A guest bootstrap left behind by
an upgrade would refuse every call with a schema complaint about an unknown key — measured by
removing `brand` from the guest's schema, which turned five isolated-template tests red with
`E_PLUGIN_PROTOCOL` — where ADR 0041's handshake exists to say plainly that the two ends
disagree. So `RPC_PROTOCOL_VERSION` is **3**, as ADR 0049 made it 2 for a new required field in
`hello`, and a stale bootstrap meets `E_PLUGIN_ACTIVATE` naming both numbers.

## Consequences

- A plugin can contribute a kit for any brand id. A template of that brand receives its logo
  and signature; a template of another brand receives `undefined` for both.
- **Each program was wired in a pull request of its own**, after the packages. `apps/cli` and
  `apps/desktop` read `brandKitsByBrand()` from the host holding the installed plugins — the
  CLI's task host; the desktop's window plugins for the preview, and each run's host for the
  export and the queue — pass its `kits` to the job and the preview, and carry its
  `diagnostics` into the run. Until then every template was handed the empty kit, which is
  what a template that never reads `context.brand` already assumed.
- A context built by hand has one more field; `noBrandKit` is what a test passes, beside
  `noFiles`, `measureNothing` and `reportNothing`.
- `@tyto/plugin-api` gains a point, a registry method and a protocol number. Below 1.0 that is
  a minor bump (ADR 0040).
- `core` and `plugin-api` still import no Node or DOM. The schemas live in
  `core/src/template/brand-schema.ts`, exported from `@tyto/core` only; the template SDK
  (`@tyto/core/template`) exports the types and `noBrandKit`, which is what a template reads.
- Not decided: how a template draws a missing logo. That is each template's choice, and the
  built-in templates' stand-in is a card of its own.
