# The slot names a template reaches for first

This document is read by template authors **and by AI agents**. Be literal.

A brief speaks its template's vocabulary: every name after `::` and every key in the
frontmatter is a slot the manifest declared (`docs/brief-language.md`). The grammar is one, but
the nouns are each template's own, so a person facing fifty templates faces fifty field
lists, and a brief written for one template breaks wholesale when pointed at another.

This is the shared core those lists start from. It is a convention on top of ADR 0005, not a
change to it: the manifest's schema, `resolve` and the brief grammar are untouched, and a
manifest that ignores this document still parses. `formats.yaml` is the precedent — one
shared list of formats instead of one per template.

## Why this exists now

**Four templates had already drifted three ways.** Measured on 2026-09-27 against `main` at
`cc4ca1d`, plus `aprovados` from PR #237:

| Role                                | `promo-curso` | `carrossel-lista` | `agenda-semana` | `aprovados` |
| ----------------------------------- | ------------- | ----------------- | --------------- | ----------- |
| The words the artwork is about      | `titulo`      | `titulo`          | `titulo`        | `titulo`    |
| The line that qualifies them        | `subtitulo`   | —                 | —               | `subtitulo` |
| The short label that sets them up   | —             | —                 | —               | `chamada`   |
| The one picture the brief supplies  | `imagem`      | —                 | `ilustracao`    | `emblema`   |
| The block that becomes one artwork  | —             | `item`            | `slide`         | —           |
| The closed list that picks the look | `cor`         | `tom`             | —               | —           |

Nobody decided any of the three splits; each is what one author did alone. About 150
templates are waiting to be ported, at least three of them in one brand's look, so every
split left in place is paid for 150 times.

## The list

A standard name is **reserved**: if a template has a slot playing that role, it uses that
name, and if it uses that name, the slot plays that role with that type. Both directions
matter — a `titulo` that is an image is worse than a template with no `titulo` at all.

| Name        | Type                                   | Role, in one sentence                                                                                           |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `titulo`    | `rich-text`, `required: true`          | The words the artwork is about, drawn largest; the one slot a brief can never leave out.                        |
| `subtitulo` | `rich-text`                            | The line that qualifies `titulo` — what, when or for whom — drawn smaller and next to it.                       |
| `chamada`   | `rich-text`                            | The short label that sets up the title block and says what kind of artwork this is: "Resultado final".          |
| `imagem`    | `image`                                | The one picture the brief supplies, wherever the template places it: behind the words, above them, beside them. |
| `lamina`    | any type, `repeat: true`               | The block that becomes one artwork: one `::lamina` is one slide of the carousel.                                |
| `tom`       | `enum`, also declared as an adjustment | The closed list that picks how the artwork looks; the adjustment of the same name overrides it on one lamina.   |

`lamina` is spelled without the circumflex because a slot name has to be the grammar's
identifier, `[a-zA-Z_][a-zA-Z0-9_-]*` (`docs/template-authoring.md`, "manifest.yaml").

What each name does **not** fix:

- **`max` and `min` stay the template's.** A 30-character `titulo` and an 80-character one
  are both `titulo`; the length is a fact about the layout, not about the role.
- **`required` is fixed only on `titulo`.** Everything else may be optional or required as
  the layout needs.
- **`tom`'s values are the template's**, with one exception: a template whose look is a
  light/dark pair spells it `claro | escuro`. A palette (`azul | laranja | verde`) is a
  brand's, and forcing it into a shared list would either be wrong for the next brand or grow
  forever.
- **What a `lamina` holds is the template's.** Plain rich text (`carrossel-lista`) and a body
  of `|`-separated lines (`agenda-semana`) are both a lamina. The name says "one of these is
  one artwork", nothing about the inside.

## `lamina` is the only repeatable name

**A slot with `repeat: true` is named `lamina`, and a slot named `lamina` has
`repeat: true`.** The manifest already allows at most one repeatable slot, because each of its
occurrences becomes an `Artwork` (`packages/core/src/template/manifest.ts`), so there is
exactly one per template and it always plays the same role: it decides how many artworks the
brief produces. A role that is structural gets a structural name.

This answers the card's open question. When TYTO-157 was written the only repeatable slot
was `carrossel-lista`'s `item`, and repeated rows inside one artwork were not drawable. Both
changed: `agenda-semana` draws several disciplines to a slide from one occurrence, and
`aprovados` draws a whole list from one. **The rows inside an artwork are not the repeatable
slot** — they are lines inside one `rich-text` value, and the template parses them. So the
standard covers the repeatable slot (`lamina`) and deliberately says nothing about the rows.

`aprovados`' `lista` is therefore not a `lamina`: it does not repeat, and the approved list is
one artwork. It keeps its own name under the freedom rule below.

## `cor` and `tom`: one role, and `tom` wins

`promo-curso`'s `cor` and `carrossel-lista`'s `tom` are the same role — the closed list that
picks the look of the whole artwork — so they get one name. The name is `tom`, because
**`cor` is already a word in the brief with another meaning**: the mark `{cor:laranja}Turma
nova{/}` colours a run of text (ADR 0017, `docs/brief-language.md`). With a slot called `cor`,
one brief would write `{cor: laranja}` on a directive to repaint the artwork and
`{cor:laranja}` inside a line to colour three words, and the two differ by one space.
`tom` has no other reading.

## The freedom rule

**A standard name describes a role in the layout; a domain name describes content.** Use the
standard name when the slot plays the role, whatever it holds. Use a domain name when the
slot's content is what the field is.

The test: _would the slot keep its name if what it held changed subject?_

- The picture above the title is the same slot whether it shows a calendar, a teacher or an
  exam board's emblem. The subject changed; the name should not. → `imagem`, not
  `ilustracao` or `emblema`.
- The block that becomes one slide is the same slot whether it holds a tip or a week of
  sessions. → `lamina`, not `item` or `slide`.
- A discipline, a professor, a session date, a rank, the approved list: the field **is** its
  content. Nothing in this list would describe it better, and `campo3` would make the brief
  stop reading itself. → keep the domain name.

**Not standardised, on purpose:** any second picture, any structured list inside one artwork,
flags such as `destaque`, per-field colours, and every domain field. A template needs no
permission to add them. If three templates later invent the same name for the same role, that
is the signal to add it here.

## What a check can enforce

TYTO-158 turns this into a warning. The boundary is written so a manifest alone decides it,
without reading template code and without judging a name nobody listed:

1. **A reserved name with the wrong shape** — `titulo` not `rich-text` or not required,
   `subtitulo` or `chamada` not `rich-text`, `imagem` not `image`, `tom` not `enum` or not
   also an adjustment, `lamina` without `repeat: true`.
2. **A repeatable slot not named `lamina`.**
3. **A known synonym**, from this closed list only:

   | Synonym                                   | Use instead |
   | ----------------------------------------- | ----------- |
   | `ilustracao`, `emblema`, `foto`, `figura` | `imagem`    |
   | `slide`, `item`, `pagina`, `card`         | `lamina`    |
   | `cor`, `tema`, `variante`                 | `tom`       |
   | `titulo-principal`, `manchete`            | `titulo`    |

A name on neither list is never flagged. That is what keeps domain names free: the check
only knows the words this document names, so `disciplina`, `professor` and `lista` pass by
construction. Growing the synonym table is a change to this document first.

## The built-in templates, checked

| Template          | Mismatch                      | Resolution                                        |
| ----------------- | ----------------------------- | ------------------------------------------------- |
| `promo-curso`     | `cor` is the look-variant     | Rename to `tom` (slot and any adjustment).        |
| `carrossel-lista` | `item` is the repeatable slot | Rename to `lamina`.                               |
| `agenda-semana`   | `ilustracao`, `slide`         | Rename to `imagem`, `lamina`.                     |
| `aprovados`       | `emblema`                     | Rename to `imagem`. `lista` stays (freedom rule). |

The renames are a separate change, made after PR #237 merges — it touches the same
templates, and renaming in parallel would conflict.

## Migrating briefs already written

Every rename above breaks briefs that exist: `::slide` and `ilustracao:` in an agenda brief
become `E_UNKNOWN_SLOT`, and the brief no longer sets its required repeatable slot.

**The answer is a major version bump, with no period in which both names are accepted.**

- **Accepting both names is not available for the repeatable slot.** A manifest may declare
  one repeatable slot, so `slide` and `lamina` cannot both be `repeat: true`. An alias would
  need a new manifest key, and changing the manifest's schema is outside this document. Half a
  transition — both names for `imagem`, one for `lamina` — would leave the agenda brief broken
  anyway and teach two rules.
- **The failure is loud and points at the line.** `E_UNKNOWN_SLOT` is an error carrying the
  range of the directive that used the old name. Nobody exports a silently wrong artwork; the
  brief writer sees exactly which word to change.
- **The bump is the honest label, not a mechanism.** A brief names a template, not a version
  (`template: agenda-semana`), so no version is ever selected; `version` only reaches
  `result.json`, as the record of which template produced a run (`docs/render-contract.md`).
  That record is exactly where the bump earns its place: a run with `agenda-semana` 3.x read
  `::lamina`, one with 2.x read `::slide`. The major number says that briefs written against
  the previous one need editing, which is what semver promises, and the changeset carries the
  list of renames for whoever reads the release notes.

The cost is one edit per brief a person reopens. Briefs outside this repository are not
renamed by Tyto (TYTO-157, out of scope).
