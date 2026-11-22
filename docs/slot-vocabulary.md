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

It covers three things a brief writer meets in every template: the slot names, the marks
that give the lines inside a block their hierarchy (`|`, `#` to `###`, `---`), and the labels
of a `Label: value` line. A template stays free to name what this document does not; what it
names here means the same in every template, whatever the template draws for it.

## Why this exists now

**Four templates had already drifted three ways.** Measured on 2026-09-27 against `main` at
`cd25d2d`, plus `aprovados` from PR rafaelsilvalor/tyto-archive#237:

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

| Name        | Type                                          | Role, in one sentence                                                                                                                                                                                                |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `titulo`    | `rich-text`, `required: true`                 | The words the artwork is about, drawn largest; the one slot a brief can never leave out.                                                                                                                             |
| `subtitulo` | `rich-text`                                   | The line that qualifies `titulo` — what, when or for whom — drawn smaller and next to it.                                                                                                                            |
| `chamada`   | `rich-text`                                   | The short label that sets up the title block and says what kind of artwork this is: "Resultado final".                                                                                                               |
| `imagem`    | `image`                                       | A picture the brief supplies with the content: one wherever the template places it (behind the words, above them, beside them), or several inside a slide (`per: lamina, multiple: true`), each where it is written. |
| `selo`      | `image`                                       | The seal art glued to the foot of the last grid slide, full width; the page above it shrinks by its height.                                                                                                          |
| `lamina`    | any type, `repeat: true`                      | The block that becomes one artwork: one `::lamina` is one slide of the carousel.                                                                                                                                     |
| `tom`       | `enum`, and an adjustment when a slot repeats | The closed list that picks how the artwork looks; the adjustment of the same name overrides it on one lamina.                                                                                                        |

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

`aprovados` first kept a `lista` that did not repeat, when the approved list was one artwork.
TYTO-190 made it a carousel the way the agenda is one: each `::lamina` is a slide and holds its
specialties and rows, so `lista` left the template (3.0.0) rather than living beside a
`lamina` that carries the same rows.

## `comum` is no slot's name

**`comum` is reserved by the brief language, not by this list** (ADR 0225): `::comum` is the
line that closes a brief's slides, so a manifest that declares a slot `comum` is refused. What
is written after it is shared by every slide and drawn below each one's own blocks — a slot
whose manifest says `per: lamina, shared: true`. Such a slot keeps its standard name: a note
the same on every slide but one is still `nota`, written once before the slides and once inside
the slide that differs, not a second slot named for the exception.

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

## A tag names a set of information, not a line

**A slot is the set; the lines inside it say their own hierarchy.** A brief that needed a
label on every line would be longer to write and slower to learn, so the shared vocabulary
names blocks of information (`::titulo`, `::apelo`) and leaves the inside to a few marks every
template reads the same way. The marks are part of this vocabulary: one joins only the way a
name does (see "Adding a name or a mark").

A table is the precedent. A template that mixes a table and running text names the table
block, and inside it the rows are still `|`-separated, as `agenda-semana` and
`simulados-semana` already write them.

### `apelo` and `convite`: two blocks every ad and carousel has

| Name      | Type        | Role, in one sentence                                                                       |
| --------- | ----------- | ------------------------------------------------------------------------------------------- |
| `apelo`   | `rich-text` | The panel that pulls the eye to one message — an offer, a guarantee, a deadline, a warning. |
| `convite` | `rich-text` | The call to act — comment, click, follow, save — wherever the template draws it.            |

`convite` takes the call to action away from `chamada`, which four templates had used for it
(see below); `chamada` keeps its reserved role, the short label over the title. The check
does not know either name yet: they join its list when the check is next changed.

The name says what the panel does, not what it holds or how it is drawn: one template draws a
card with a band, another a round badge, and both are `apelo`. It was chosen over `oferta`,
because what the panel says is not always an offer, and over `destaque`, which the user manual
already uses as its example adjustment (`::lamina {destaque}`), the same clash that made
`cor` give way to `tom`.

### `corpo`: the general information under the title

| Name    | Type                     | Role, in one sentence                                                                                   |
| ------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `corpo` | `rich-text`, with levels | The general information under the title — vacancies, exam board, roles, salary — as a block of its own. |

**The title names; the body informs** (maintainer, 2026-11-22). A `titulo` holds the name (`#`)
and what qualifies it in the same breath (a status as `##` before the name); the facts a reader
checks after it — `**700 vagas** · Banca Cebraspe`, `## Salário inicial de R$ 5,6 mil` — go in
`corpo`. Kept apart, each block takes its own size and its own `peso`: a long name that shrinks
to fit its width no longer takes the vacancies down with it, and a short one that grows no
longer blows the salary up.

Inside, `corpo` reads the levels below as every block does. **A line with no mark is drawn
smaller than every marked level**, so the marked lines carry the weight: the kit's
`bodyBlock` (TYTO-831, ADR 0224) sizes it as the smallest marked size times its
`unmarkedRatio` parameter, 0.8 by default. A template that repeats its artworks may declare
`corpo` `per: lamina` with `shared: true` (ADR 0225), so one slide can carry other facts. A
template that has no `corpo` keeps drawing the facts from `titulo`, as before.

### Levels inside a block: `|`, `#` and `---`

**Each line of a block is drawn in the order written; the brief writer orders the
information, the template draws it.** Inside one line:

- **`|` separates the parts of one line**, and each part is one level of the line's
  hierarchy. Spaces around it are not part of the words.
- **`#`, `##` and `###` before a part mark its level**: `#` is the main part, `##` the
  second level, `###` the third. A part with no mark is the base level. The template decides
  what each level looks like — size, weight, case, letter spacing — so the same marks give a
  different, consistent look in each template.
- **The block's first line, with no `#` at all, is read by position**, so most titles need no
  mark. **Any later line with no `#` is a supporting line**: all of it is the base level, after
  the block's main part — the cargos under the exam's name need no `###`, and a later line that
  should stand out says so with `##`.

  | Parts | Read as         | Example                                      |
  | ----- | --------------- | -------------------------------------------- |
  | 1     | `# a`           | `Concurso TRT 4 (RS)`                        |
  | 2     | `# a \| b`      | `Concurso TRT 4 (RS) \| Edital publicado`    |
  | 3     | `a \| # b \| c` | `Concurso \| TRT 4 (RS) \| Edital publicado` |
  | 4+    | `a \| # b \| …` | the second part is the main one              |

- **A line that is only `---` is the divider.** The template draws its own divider there — a
  row of dots, a single rule, a double rule, a dashed one. The brief only says where it goes.
- **A `\` breaks the line inside its part, wherever it is written.** `Concurso | # ABIN \ 2027`
  is one main part drawn on two lines, both at the main level; it never starts a new line of
  the block. Spaces against the `\` are not words, and a `\` at either end of a part breaks
  nothing (TYTO-822).

The same words, three hierarchies:

```brief
::titulo
  Concurso | # TRT 4 (RS) | ## Edital publicado

::titulo
  ## Concurso | # TRT 4 (RS) | Edital publicado

::titulo
  # Concurso TRT 4 (RS) | ## Edital publicado
  ---
  Ganhe até R$ 16 mil por mês!
```

And one `apelo` shaping itself to what it was given — the template finds the main part and
draws the rest around it:

```brief
::apelo
  Pacotes com 40% OFF | Por tempo limitado

::apelo
  Lote Especial | # Pacotes com 40% OFF

::apelo
  Lote Especial | Pacotes com 40% OFF | Por tempo limitado
```

The kit draws that card: `cardSegments` turns the parts into a title, a band and a foot, and
`card` gives the band the corners of the edge it reaches (TYTO-800).

The brief language is untouched: `|`, `#` and an indented `---` are plain text inside a block
today (checked by parsing the examples above with `parseBrief`: no diagnostic, every line a
text run). Reading them into levels is the template's, through `@tyto/template-kit`, so no
template parses them its own way: `levelsOf` reads a block into lines of parts with their
level and position, and `levelStack` draws them one part per row, each level looking as the
template's `look` says, with the template's own divider (TYTO-807). The space between two
lines, and between two parts of a line, is the template's too: one number for every pair, or a
function of the neighbours around the gap, so a template gives the room under a `#` line its
own size without counting lines (TYTO-810). A `---` that
starts at the left margin is still the frontmatter's fence; the divider is always indented,
inside a block.

**Never change the words.** The marks reorder and rank what the copy says; a brief writer, or
the brief modeller, moves a part to another place in the line only when the meaning stays the
same, and never rewrites it.

### Labels inside a block

A line written `Label: value` is a pair, and the label is part of this vocabulary too: the
same label means the same fact in every template. `Banca:` and `Vagas:` are written by four
templates each; `Salário:`, `Inscrições:` and `Prova:` by two each, under the synonyms in the
table below in two more. A label is for a fact with a name; a
hierarchy of words is written with `|` and `#`, not with labels.

### `peso`: a block's weight

`peso` is the shared adjustment that makes one block of the artwork larger or smaller than
designed, to set its hierarchy from the brief (maintainer, 2026-11-21): `::nota {peso: 3}`.
It takes `1`, `2` or `3`, and `2`, the design's own size, is the default.

```yaml
adjustments:
  peso: { type: enum, values: ['1', '2', '3'], default: '2', applies: [titulo, apelo, nota] }
```

A template declares it on every content block it hands to the kit's block column (TYTO-824,
ADR 0224), and reads it with the kit's `weightOf`, which turns it into the scale the block is
built at: `1` is 0.85 of the reference sizes, `2` is 1, `3` is 1.2. The three scales are the
column's parameters, so a template may set its own; the values a brief writes are the same in
every template. A block written without `peso` is built as designed.

## Names in use that drift, not checked yet

These were counted on 2026-11-19 over the 14 production templates in their own repositories
(manifests and example briefs). They are the convention from now on; the check's closed
synonym list below does not know them yet, and each rename is a card per template
repository.

| In use                             | Where                                                                     | The convention                  |
| ---------------------------------- | ------------------------------------------------------------------------- | ------------------------------- |
| `fechamento`                       | concursos-abertos, concursos-abertos-saude                                | `fecho`: the closing words      |
| `abertura`                         | concursos-abertos, concursos-abertos-saude                                | `titulo`                        |
| `{fecho}` as the closing slide     | questao-estrategica, questao-engenharia, voce-conhece                     | `{contracapa}`, beside `{capa}` |
| `Remuneração:`, `Salário inicial:` | concursos-abertos, concursos-abertos-ec                                   | `Salário:`                      |
| `Período de inscrições:`           | concursos-abertos-ec                                                      | `Inscrições:`                   |
| `Data da prova:`                   | concursos-abertos-ec                                                      | `Prova:`                        |
| `chamada` as a call to action      | simulados-semana, concursos-abertos, concursos-abertos-saude, informativo | `convite`                       |

`{fecho}` gives way to `{contracapa}` for the reason `cor` gave way to `tom`: `fecho` is
already the slot for the closing words, and a slot and an adjustment of the same name would
mean two things.

Two roles were settled by the maintainer on 2026-11-20:

- **`chamada` keeps the short label over the title** ("Resultado final"), as `aprovados` uses
  it. The four templates that drew a call to action under that name rename it `convite`. The
  shape of the two is the same, so the check could never have told them apart.
- **`imagem` covers both uses already in production**: the one picture on a cover
  (`agenda-semana`, `aprovados`) and the figures inside a slide (`questao-estrategica`,
  `questao-engenharia`, `voce-conhece`). No template renames it.

## Adding a name or a mark

**A name or a mark joins this document only when nothing in it plays the role.** The pull
request that adds one says which entries it considered and why none fits, and it lists the
templates that need it. Three templates inventing the same name for the same role is the
usual signal; one template's need is usually a domain name, which needs no entry.

## What a check can enforce

TYTO-158 turns this into a warning. The boundary is written so a manifest alone decides it,
without reading template code and without judging a name nobody listed:

1. **A reserved name with the wrong shape** — `titulo` not `rich-text` or not required,
   `subtitulo` or `chamada` not `rich-text`, `imagem` not `image`, `tom` not `enum`, `tom`
   not also an adjustment in a manifest that declares a repeatable slot, `lamina` without
   `repeat: true`. The adjustment is owed only beside a `lamina` because what it does is
   override `tom` on one lamina: a one-artwork template such as `promo-curso` has nothing to
   override it on, and a plain `tom` enum is its whole look.
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

**Where it fires: `tyto template check`, and only there.** Each finding is `W_SLOT_VOCABULARY`
at the slot's entry in `manifest.yaml`, a warning that never changes the exit code (ADR 0025).
Both routes get it — a markup template and a code template, whose manifest is all `check`
reads — and so does a plugin's template pack, whose author runs the same command on
`<pack>/templates/<name>` (`docs/plugin-authoring.md`). A render, the desktop and installing
a pack never report it: the template's author is the only person who can act on it, and a
brief writer warned about a template's naming can do nothing but read the warning. The rules
live in `packages/core/src/template/slot-vocabulary.ts`, which names this section as its
source.

## The built-in templates, checked

| Template          | Was                   | Now                | Version       |
| ----------------- | --------------------- | ------------------ | ------------- |
| `promo-curso`     | `cor`                 | `tom`              | 1.0.0 → 2.0.0 |
| `carrossel-lista` | `item`                | `lamina`           | 1.0.0 → 2.0.0 |
| `agenda-semana`   | `ilustracao`, `slide` | `imagem`, `lamina` | 2.0.0 → 3.0.0 |
| `aprovados`       | `emblema`             | `imagem`           | 1.0.0 → 2.0.0 |
| `aprovados`       | `lista`               | `lamina` (repeats) | 2.0.0 → 3.0.0 |

The second `aprovados` row is TYTO-190: `lista` became the repeatable `lamina` when the template
learned to run across several slides. Class names and scene node names
(`.item`, `illustration`, `emblem`) were left alone: they are the template's own English
vocabulary, not the brief's, and keeping them is what kept the pixels still: every example's
PNG is byte-identical before and after the rename.

**The artwork's id is the one thing besides the brief that changed.** An artwork is named
after the repeatable slot, and that name reaches two places:

- the file name: `item-1-feed.png` is now `lamina-1-feed.png`, `slide-1-retrato.png` is now
  `lamina-1-retrato.png`;
- the SVG's element ids, which start with the artwork's: `id="slide-1.retrato.…"` is now
  `id="lamina-1.retrato.…"`. With that prefix renamed, every SVG is otherwise identical.

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
  range of the directive that used the old name, so the brief writer sees exactly which word
  to change. An old agenda brief rendered against 3.0.0 gets three of them — the frontmatter
  key and both `::slide` — plus `E_BAD_SLOT_VALUE` for the `lamina` it no longer sets, and
  `tyto render` exits `1` with `status: "error"`. It still writes the one artwork it could
  draw, a cover with no picture and no table; that is the render contract's "rendered, with
  errors" (`docs/render-contract.md`), and `status` is what says the folder is not
  publishable.
- **The bump is the honest label, not a mechanism.** A brief names a template, not a version
  (`template: agenda-semana`), so no version is ever selected; `version` only reaches
  `result.json`, as the record of which template produced a run (`docs/render-contract.md`).
  That record is exactly where the bump earns its place: a run with `agenda-semana` 3.x read
  `::lamina`, one with 2.x read `::slide`. The major number says that briefs written against
  the previous one need editing, which is what semver promises, and the changeset carries the
  list of renames for whoever reads the release notes.

The cost is one edit per brief a person reopens. Briefs outside this repository are not
renamed by Tyto (TYTO-157, out of scope).
