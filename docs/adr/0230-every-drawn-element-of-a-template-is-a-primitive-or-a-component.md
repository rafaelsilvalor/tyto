# 0230 — Every drawn element of a template is a primitive or a component

Status: accepted · 2026-11-26 · TYTO-885 · amends ADR 0224 (decisions 4 and 5); builds on ADR
0047, ADR 0151 and ADR 0153

## Context

ADR 0224 fixed the contract a layout piece follows: it takes an area and declared parameters and
returns a measured `Block`. It named two kinds of piece — a **primitive**, a mechanism with no
subject, and a **component**, a piece that reads named slots — and said a template is a root
arrangement of components. The maintainer confirmed that meaning on 2026-11-25 and set the
direction it serves: "agora cada elemento precisa ser um componente […] A ideia é que os
templates sejam montados 100% com componentes; se um elemento por si só não é tão complexo e
customizado para ser um componente chamaremos de primitivo". The goal is a node-based template
editor, each piece one node.

ADR 0224 left three things open that the batch kit-adoption ran into.

**Whether every drawn element goes through a piece.** The batch's survey (2026-11-25, read in
the code on each repository's `origin/main`, not rendered) counted 13 template repositories and
9,248 lines. Six of them — concursos-abertos, concursos-abertos-ec, informativo,
news-da-semana, questao-estrategica, voce-conhece: 6,879 of the 9,248 lines — draw every element
with core `rect`, `text` and `vector` nodes at absolute coordinates. The same helpers are copied
from one to the next: `capOffset` in 6 repositories, `textAt` in 5, a next-slide arrow in 5
variants (TYTO-793 counts them).

**How text placed by the top of its capitals survives composition.** Those six templates place
every line by the top of its capitals, as the reference art measures it. A `Block` is a box
(`{ width, height, draft }`), so a stack can only put boxes one under the next; the templates
compute `(lines − 1) × pitch + cap height` by hand in about ten places to know where the next
line's capitals go.

**When the older kit pieces follow the contract.** ADR 0224 decision 5 moved each piece "when a
card touches it". By the survey, three of the kit's roughly eighteen pieces take an `Area` and
export a parameter schema (`bodyBlock`, `blockColumn`, `mainLineScale`); the ones templates use
most do not.

Phase 1 of the batch is the evidence that the rule can bind. Seven pieces of hand-placed art in
six templates moved onto the kit's `table` and `buttonRow` with every rendered PNG byte-identical
to the one before (TYTO-878, 879, 880, 881, 882, 883, 884). Where a kit piece could not yet say
what the art needed, the gap was measured and closed in the kit first: a row name per row kind
and a zebra that leaves a row bare (TYTO-878), a button holding an icon alone and a trailing piece
with no box (TYTO-884). One alternative was measured and refused: an end box in a pill's own fill
repaints the pill's rounded end, and 106 of 1,458,000 pixels of the cover changed, the worst
channel by 24 of 255 (TYTO-881).

## Decision

1. **A template's `template.ts` draws nothing with core nodes directly.** Every element it draws
   is a primitive or a component of `@tyto/template-kit`, or a private piece that follows the
   same contract (ADR 0224 decisions 1 to 4). What stays in the template:
   - the **wiring**: which pieces, in which order, inside one root arrangement over the frame's
     area, and the values it sets (ADR 0224 decision 3);
   - the **reference's coordinates and sizes as data** — a table of numbers the pieces are
     handed, as `BUTTON` and `ICON_ROWS` are in questao-estrategica after TYTO-881;
   - **third-party marks** that cannot enter the public kit (a network's logo, an institution's
     emblem), held as data — a path or a file — and handed to a kit primitive to draw.

   **When it binds:**
   - **A new template binds now.** It is written by picking components and wiring them; a piece
     it needs and the kit lacks is a kit card first.
   - **The six hand-drawn templates bind through the batch template-recompose** (TYTO-892 to
     TYTO-897), one card per template.
   - **The templates whose art is a `@tyto/house-style` composition bind with TYTO-524**, which
     decides what house-style becomes: simulados-semana (`simuladosDaSemana`), tabela
     (`oneImageTable`) and banner (`productBanner`), read in their `src/template.ts` on
     2026-11-26. Their `template.ts` already draws nothing itself; the core nodes are inside the
     house's composition.
   - **Until the picture and shape primitives exist** (TYTO-625, TYTO-886), a template may draw
     an image or a shape with core nodes, only inside a local function whose comment names it as
     pending and the card that replaces it.

2. **A `Block` carries an optional text anchor: `anchor?: { capTop, baseline }`.** Both numbers
   are in the block's own coordinates: `capTop` is the top of the first line's capitals,
   `baseline` the baseline of its last line.
   - **A block of text answers it**, measured from the face's metrics and the lines it laid out.
   - **A block with no text leaves it absent** — a shape, a picture, an empty block. A reader
     treats an absent anchor as `{ capTop: 0, baseline: height }`: the box's own edges.
   - **An arrangement passes it on.** A composite answers the `capTop` of its first child and the
     `baseline` of its last, each offset by where it placed them; `stack`, `row`, `inset` and `at`
     keep it through every move, so a block nested any number of times still knows where its
     capitals start.
   - **`stack` and `blockColumn` gain one declared parameter, `measureFrom`**, `'box'` or
     `'capitals'`, defaulting to `'box'`. With `'box'` nothing changes: a gap runs from one box's
     foot to the next one's top, as today, so every existing render keeps its bytes. With
     `'capitals'` a gap runs from the upper block's `baseline` to the lower block's `capTop`,
     which is the pitch the six templates compute by hand.

   TYTO-793 gives the anchor to the text pieces and makes the arrangements pass it on; TYTO-891
   adds `measureFrom` with the arrangements' parameter schemas.

3. **The older kit pieces follow the contract on a schedule, not when touched.** ADR 0224
   decision 5 is replaced for these pieces: TYTO-891 moves `table`, `slotTable`, `buttonRow`,
   `card`, `cardRow`, `titleBlock`, `levelStack`, `textBlock`, `grownTextBlock`, `stack`, `row`,
   `inset`, `mark` and `icon` to an area and an exported parameter schema whose defaults are
   today's values, with one overflow convention (returned, as `blockColumn` returns it). Their old
   signatures stay as thin wrappers until the recomposition batch drops their last caller; their
   renders do not change.

   **Debt phase 1 left on purpose**, to be paid by its named card:
   - the cover arrows of questao-engenharia and voce-conhece sit inside the button's words block,
     written before `buttonRow` had a trailing piece with no box; they move to that slot in
     TYTO-896 and TYTO-897;
   - house-style's call to comment already moved its balloon out of the words (TYTO-884) and
     carries no debt.

4. **Generic pieces live in the kit; anything with a brand lives in a private package.** A
   primitive, or a component that knows no brand, belongs in `@tyto/template-kit`. A piece that
   carries a brand — a logo's geometry, a house colour, house copy, a house layout — lives only in
   a private package or a template's own repository, never in this public repository (ADR 0224
   decision 4, ADR 0151, `AGENTS.md` › Hard rules). What becomes of `@tyto/house-style`, which
   holds the house's compositions today, stays with TYTO-524.

## What this record does not decide

- The visual editor, how a graph of pieces is serialised or stored, and how a component is
  packaged on its own: ADR 0224 decision 6 still holds.
- **Enforcement.** Whether a lint rule refuses core drawing nodes in `template.ts`, as
  `templates/numbers-are-tokens` refuses numeric literals there today, is decided later, once the
  recomposition is done and a refusal would not stop every existing template at once.
- The order in which the six templates are recomposed, and what each one's components are: the
  batch template-recompose decides that per card.
- What `@tyto/house-style` becomes (TYTO-524).
- Where third-party marks are kept when more than one template needs the same one.

## Consequences

- A template written from now on is reviewed against one question beyond ADR 0224's three: does
  `template.ts` draw anything itself. The answer is "no", or a named pending function under
  decision 1.
- Text placed by its capitals composes like any other block once TYTO-793 lands: the hand
  computation of a line's foot leaves the templates, and the gap between two texts becomes a
  parameter of the arrangement.
- The kit's pieces gain schemas before the editor exists, so an editor can draw a panel for each
  without reading its code.
- The cost is two kinds of work this batch does not finish: the six recompositions and the
  migration of fourteen pieces. Until both land, the rule binds new work and the debt is named.
