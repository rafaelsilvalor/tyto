# 0155 — A configuration picks its brand, the brand's kit carries its accent, and a configuration may restrict its formats

Status: proposed · 2026-10-29 · TYTO-455 · amends ADR 0063 (a plugin contributes a brand kit)
and ADR 0151 (plugin files install and configure templates) · builds on ADR 0052, ADR 0055,
ADR 0065, ADR 0066 and ADR 0153

## Context

ADR 0151 lets a plugin file give one template several named configurations, each reached by an
alias. On 2026-10-28 the maintainer asked for the brand kit to be part of a configuration, so one
template can be `tabela-roxo` with roxo's kit and `tabela-azul` with azul's, and decided that
**the colours come with the kit**: switching a configuration's brand switches the logo, the
signature and the colours at once.

**What exists at `origin/main` fbabe97, read in the code.**

- A manifest names one `brand` (ADR 0052). `compile` hands a template the kit under that brand
  and no other (`brandKitOf` in `packages/core/src/brief/compile.ts`, ADR 0063). A configuration
  cannot change it.
- A kit is `{ logo?, wordmark?, signature? }` (`BrandKit` in `packages/core/src/template/brand.ts`,
  ADR 0063, ADR 0066). It carries no colour. `brandKitSchema` is strict and sits both in the
  `brand-kit` registration and in `templateCallSchema`, at `RPC_PROTOCOL_VERSION` 10.
- **A brand's colour lives in `@tyto/house-style` `brands.ts`** (ADR 0055). Per brand it holds
  exactly one colour, the `accent`: ocre `#c37d2c`, vinho `#88002e`, roxo `#5900a6`.
  `ROXO_TABLE` reuses roxo's. The other field, `signOff`, is copy: the kit's signature, or roxo's
  line pointing at the story's link, which ADR 0065 keeps out of the kit. azul's accent is a token
  of its own (`INK` in `templates/_azul/tokens.ts`). The banner's two logo inks (`MARK_INKS` in
  `banner-roxo/template.ts`) are the colours ADR 0066 maps the logo's tones to, chosen by the
  template that places the mark.
- ADR 0153 declares eleven configurable values on `tabela-roxo` and leaves the accent out on
  purpose: "it is the brand's".
- `simulados-semana-roxo` renders `[story]` and `-ocre` and `-vinho` render `[grid, story]`, each
  in its own manifest. ADR 0151 merges them into one template with three configurations
  (TYTO-441). The `brief` block of a configuration, `brief.formats` among it, is TYTO-440, in
  flight. Its `formats` is a default the brief may override, so it cannot say "roxo has no grid".
- With no kit installed, every built-in template draws ADR 0065's placeholders, and TYTO-453's
  snapshots are rendered that way.

## Decision

### 1. A configuration may set `brand:`

A configuration in a plugin file gains an optional `brand`, beside `alias`, `values` and `brief`.
It follows the manifest's brand rule (ADR 0052): lower case letters, digits and single hyphens.
A value that breaks the rule is a warning on that key, and the configuration keeps the brand it
would have had without it.

```yaml
version: 1
templates:
  tabela:
    source: { git: https://github.com/rafaelsilvalor/tyto-template-tabela.git, ref: v1.1.0 }
    default: roxo
    configurations:
      roxo:
        alias: tabela-roxo
        brand: roxo
      azul:
        alias: tabela-azul
        brand: azul # azul's logo, signature and accent
```

**Which brand a render draws, first match wins:** the configuration the brief reached, then the
entry's `default` configuration (a configuration starts from the default and changes what it
lists, as its values do), then the manifest's `brand`. `compile` hands the template the kit under
that brand. **This amends ADR 0063**, where the kit was always the manifest's. A template is
still never handed a brand nobody chose for it: the choice moves from the manifest alone to the
manifest and the plugin file. The manifest's `brand` keeps its other job (ADR 0052): it says
whose look the template draws by default, and pickers filter on it.

**The brief does not get `brand:`.** A brief that names an alias has already chosen a variant,
and a brief that could name a brand would let any document paint any template in any brand's
look, which is what a configuration exists to decide once, in a file somebody reviews. So the
precedence of ADR 0151 (template < file < brief) holds for the brand with the brief side empty.

### 2. The kit carries the brand's accent, and only the accent

`BrandKit` gains `colors?: { accent?: string }`, a hex colour as ADR 0153 writes one
(`#rrggbb`). The record is **closed and strict**, like the rest of the kit: any other key is
refused at activation.

**Only the accent**, because it is the one colour `brands.ts` holds per brand. Not the sign-off:
it is copy, and roxo's note is a line of the piece, not of the brand (ADR 0065). Not the logo's
tone inks: a tone is a role and the template that places the mark says which colour it is
(ADR 0066), so the banner keeps mapping `primary` and `secondary` itself. A second colour joins
`colors` by an ADR when a piece needs one, as a third tone would join `MarkTone`.

A private kit (`tyto-brand-kit`) fills `colors.accent` for its brands, with the same hex
`brands.ts` holds for ocre, vinho and roxo. The kit stays a plugin contribution keyed by brand
(ADR 0063); earlier still wins, and a shadowed kit is still `W_BRAND_KIT_SHADOWED`, colours and
all.

### 3. A template reads the accent through the house, with its own fallback

`@tyto/house-style` gains `accentOf(kit, fallback)` in `kit.ts`, beside `logoOf` and
`signatureOf`: the kit's accent when it has one, the fallback otherwise. Every house template
that draws a brand's accent reads it through it, and **the fallback is the constant it draws
today**: `ROXO.accent` for the roxo templates, `OCRE.accent` and `VINHO.accent` for theirs,
azul's `INK` for azul's. A template outside the house reads `context.brand.colors?.accent` with a
fallback of its own, as ADR 0153 point 4 does for values.

**The accent is not a declared value.** ADR 0153 left it out of `values`, and it stays out: two
places that set one colour would let a file give roxo's logo azul's accent, and the precedence
between them would be one more rule nobody reads.

### 4. A configuration naming a brand with no installed kit: placeholders and one warning

The template draws ADR 0065's placeholders for the logo and the signature, and its fallback
accent (decision 3). Nothing is substituted from another brand's kit.

**`W_BRAND_KIT_MISSING`**, reported where configurations are resolved, once per configuration,
at the range of its `brand:` key, naming the brand and the alias. Not fatal: the run renders. It
is reported **only for a brand a configuration names**. A manifest's brand with no kit stays
silent, as it is today: a public install and the CI render the built-in templates that way on
purpose, and a warning on every such render would be noise. A brand written in a plugin file is
a choice somebody made, and a typo there is the likely reason no kit answers.

To report it, the resolution of configurations is handed the set of brands the installed kits
offer, which `PluginRegistry.brandKitsByBrand()` already answers.

### 5. What stays in `@tyto/house-style`

- The compositions, the shared tokens and parts, `Brand.signOff` and `CALL_TO_COMMENT`.
- **The per-brand accents, as the templates' fallbacks only** (decision 3). They are no longer
  where a brand's colour is decided: a kit that supplies one wins. When a production template
  leaves for its own repository (TYTO-434, TYTO-435, TYTO-441), its fallback goes with it.
- A brand that never had a built-in template, such as marinho, gets nothing here: its colour is
  in its kit only.

### 6. A configuration may restrict its formats, which a brief cannot widen

A configuration gains an optional `formats:` beside `brand:`: the formats this configuration
renders, **a subset of the manifest's**. It is a restriction, the configuration's own contract,
not a default:

- A brief that reaches the configuration and asks for a format outside the list gets
  `E_UNKNOWN_FORMAT`, exactly as if the template did not render it, with the configuration's
  list as what it renders. A run's `--format` meets the same check (ADR 0107).
- A format in the list that the manifest does not declare is a warning on that entry in the
  plugin file, and the entry is dropped. An empty list after that is a warning on the key, and
  the configuration keeps the manifest's formats.
- It is inherited from the entry's `default` configuration like the brand (decision 1).

**`brief.formats` (TYTO-440) is different**: it is the default a brief starts from when it lists
none, and the brief may list any format the template, or the configuration's restriction,
renders. The restriction bounds; the default suggests inside the bound.

```yaml
simulados-semana:
  source: { git: ..., ref: v1.0.0 }
  configurations:
    roxo:
      brand: roxo
      formats: [story] # restriction: `formats: [grid]` in a brief is E_UNKNOWN_FORMAT
    ocre:
      brand: ocre
      brief:
        # default: a brief with no `formats` renders the story;
        # one that writes `formats: [grid, story]` renders both
        formats: [story]
```

This is the same fact ADR 0055 kept in a manifest, "roxo has no grid", which a pipeline refuses
against rather than a template drawing around. Merging three manifests into one template must
not lose it. Restricting formats leaves the composition alone, so it does not break ADR 0151
decision 1. The implementation is TYTO-441's.

### 7. How the cards that wait use it

- **TYTO-441.** `simulados-semana` is one template with configurations `roxo`, `ocre` and `vinho`,
  each with its `brand:`, and roxo with `formats: [story]`. Today's three names are those
  configurations' default aliases. The composition reads its accent through `accentOf`. roxo's
  sign-off note is copy: it moves to the brief side (TYTO-440's `brief.slots`), or to a declared
  value once a text kind exists. It does not go into the kit.
- **TYTO-465.** marinho is a kit entry in the private kit repository (logo, signature,
  `colors.accent`) and a configuration with `brand: marinho` in a plugin file. Nothing in this
  repository changes for it.

## Consequences

- **TYTO-440 lands first.** It is changing the plugin file's configuration and the call in
  `core`, `plugin-api`, the CLI and the desktop now. This ADR's code is a fresh branch on top of
  it.
- `brandKitSchema` gains `colors`, and it sits in `templateCallSchema` and the `brand-kit`
  registration. A guest bootstrap on 10 would refuse a kit with colours with a schema complaint,
  so **`RPC_PROTOCOL_VERSION` goes from 10 to 11**, as ADR 0063 and ADR 0066 bumped it, and a
  stale bootstrap is refused by the handshake naming both numbers.
- **`@tyto/plugin-api` takes a breaking release** under ADR 0149 point 4, with its changeset.
  `@tyto/core` takes a minor one for the optional `colors` and the configuration's `brand` and
  `formats`. A kit plugin that writes `colors` moves its `engine` range to the Tyto that reads
  it; a Tyto released before this one refuses it at activation, because the schema is strict.
- **Built-in templates render the same bytes**: with no kit, `accentOf` answers today's constant,
  so TYTO-453's snapshots do not move, and with the private kit the accent is the same hex. The
  card's test perturbs a kit's accent and sees the output change, which proves the colour comes
  from the kit.
- `TemplateSelection` and `ResolvedBrief` gain the chosen brand and the configuration's formats.
  `compile` reads the brand from the selection before the manifest.
- `docs/diagnostic-codes.md` gains `W_BRAND_KIT_MISSING` and the configuration's formats
  warnings in the code pull requests.
- Not decided: a second kit colour, and a text kind of declared value.

## Rejected

- **`brand:` on the brief.** A document would choose any brand's look for any template. A variant
  is chosen by an alias, in a reviewed file (decision 1).
- **The accent as a declared value in `values`.** It gives one colour two sources, and a file
  could pair one brand's logo with another's accent (decision 3).
- **The colours kept in `house-style`, keyed by the configuration's brand.** A private brand such
  as marinho would need its colour in a public package and a release of it. The maintainer
  decided the colours come with the kit.
- **An open record of colours in the kit**, any name a template asks for. A kit and a template
  would agree on names nothing checks, and a misspelt one would fall back without a word. The
  record is closed and grows by ADR.
- **The kit choosing the logo's tone inks.** It would undo ADR 0066's "a tone is a role", and the
  one template that maps tones is roxo's banner, which draws one brand.
- **A neutral placeholder accent when no kit is installed**, as ADR 0065 draws a placeholder logo.
  It would change the bytes of every built-in template rendered without a kit, CI included, and
  TYTO-453's snapshots with them.
- **An error for a missing kit.** A render with placeholders is the normal public case, and ADR
  0151 keeps a plugin file tolerant per entry.
- **A warning for every brand with no kit, the manifest's included.** Every public and CI render
  would carry it (decision 4).
- **`brief.formats` alone for roxo's missing grid.** A default the brief may override cannot say
  that the piece has no grid (decision 6).
- **A separate ADR for the formats restriction.** TYTO-441 needs both rules at once, and one rule
  does not earn a record of its own.
