# 0224 — A layout piece takes an area and declared parameters, and returns a measured block

Status: accepted · 2026-11-22 · TYTO-824 · builds on ADR 0047, ADR 0153 and ADR 0167; frames
TYTO-823, TYTO-824, TYTO-825 and TYTO-826

## Context

A TypeScript template is already close to a graph. In `anuncio` (its own repository,
`src/template.ts`, `build`), `::titulo` goes through `levelsOf` and `levelStack` to a head,
`::apelo` through `cardSegments` and `card` to an offer, `::nota` through a centred text
block — and then a hand-written assembly places the three from the bottom up with fixed numbers
(`HEAD_GAP = 56`, `PROOF_GAP = 42`, the logo's top). That assembly is where the maintainer's
2026-11-21 feedback comes from: a large empty gap between head and offer, a title that does
not grow into its space, and a card that grows without a limit.

The maintainer wants templates to become more dynamic: build a set of elements on their own,
and arrange them into a template, so the same element is reused across different templates by
including it as one node (2026-11-22). Later, a node-based template editor, in the manner of a
geometry-node graph: pieces wired together, each with a panel of controls. Such an editor can only be built over
pieces that share one contract and say what they accept. The kit's pieces today take a width
and return a `Block` (`{ width, height, draft }` in `packages/template-kit/src/blocks.ts`), but
the height available never reaches them, and each hides numbers in its body. TYTO-824 and
TYTO-825 are about to add the first layout pieces (a column of blocks, a title that fits its
width, a height limit); fixing their shape after they ship would mean rewriting them for the
editor. So the rule is fixed first.

## Decision

1. **A layout piece takes an area and returns a measured block.** An area is the room offered:
   an available width **and** an available height (`Area = { width, height }`, the height
   allowed to be unbounded where a piece is only asked to measure). The piece answers a `Block`
   whose `width` and `height` are what it actually used, measured with `context.measure`, never
   guessed — so the caller knows the truth before it places anything. A piece never reads the
   frame's size or another piece's position on its own; what it may use comes in through its
   area and its parameters.

2. **No hidden constants: every number a piece uses is a declared parameter.** Each spacing,
   size, minimum, maximum, floor, ratio and weight is a named, typed parameter with a default,
   listed in a schema the piece exports beside its function (a plain object a tool can read
   without running the piece: name, kind — length, ratio, count, choice —, default, optional
   limits). The defaults are the values the reference art measured; a template overrides them
   by passing parameters, never by editing the piece. This is ADR 0153's rule (a template
   declares its configurable values in its manifest) carried one level down, to the kit, and
   for the same reason: an editor draws a panel only from a list it can read. A template's own
   manifest `values` may feed a piece's parameters; the piece does not know where they came
   from.

3. **Layout is itself a piece, and it works in two passes.** An arrangement — a column that
   stacks, centres, spaces by weight (ADR 0167) and respects a height limit — takes blocks (or
   pieces that make blocks) and returns one block, under decisions 1 and 2. It first **measures**
   every child against the area it would offer, then **places** them: it can shrink, drop or
   space children only because it knows their sizes before it commits a position. A template's
   `build` becomes a wiring of pieces into one root arrangement over the frame's area, with no
   assembly of its own beyond that wiring.

4. **A template is an arrangement of components.** The goal these rules serve: an element — a
   title head, an offer card, a proof note, a logo foot — is built, tested and versioned on its
   own, and dropped into any template as one node. Two kinds of piece, one contract:
   - A **primitive** is a mechanism with no subject: a text block, `levelStack`, `card`, the
     column. It knows how to measure and arrange, never what it shows.
   - A **component** is a piece that has a subject: it reads named slots or values (`::titulo`
     with its levels, `::apelo` as a card) and composes primitives into one block — the head,
     the offer, the note. It is what a template author picks from a list and places.
     Both take an area and declared parameters and return a measured block (decisions 1 and 2);
     that shared contract is what makes a component pluggable into any arrangement. A template is
     then a root arrangement of components over the frame's area, plus the values it sets.
     **Where they live:** primitives and generic components with no brand in them belong in
     `@tyto/template-kit` (public). A component that carries a brand — a logo, a house colour, a
     house layout — lives only in a private package or template repository, never in this
     repository or the kit, by the public-repository rule in `AGENTS.md` and ADR 0151. The name
     **component** ("componente" in Portuguese) is this record's proposal; the maintainer may
     rename it, and the rename is a wording change, not a new decision.

5. **How the open cards apply it.**
   - **TYTO-823** (core): the brief's block order reaches `TemplateContext` per artwork. It is
     the graph's input list — which pieces, in which order — and adds no layout.
   - **TYTO-824** (kit): the block column is the first arrangement under decision 3. It takes an
     area, the blocks in the context's order, and declared parameters (the gaps between
     neighbours, the vertical alignment, and `peso` read from each slot's adjustment with the
     scales 0.85, 1 and 1.2 as parameter defaults); it measures, then places, and reports what
     does not fit.
   - **TYTO-825** (kit): the title's main line that fills its width and the column's height
     limit are the first pieces that use a real height: the fit takes the area's width and a
     height cap, its minimum, maximum and cap ratios declared; the column shrinks every child by
     one factor down to a declared floor before it reports an overflow.
   - **TYTO-826** (anuncio): `build` replaces its hand-written assembly with the column over the
     panel's area, the head, offer and note as its children, each written as a component under
     decision 4 (generic ones may later move to the kit, anything with brand stays private); the fixed gaps become parameters
     with the reference's values as defaults, and the photograph's minimum height (25% of the
     frame) is a parameter of the template, not a constant buried in a function.
   - Existing kit pieces (`levelStack`, `card`, `grownTextBlock`…) are not rewritten by this
     record. Each moves to the contract when a card touches it; a piece that does not yet take
     an area is called with one built from its width.

6. **What this record does not decide.** The visual editor itself (its interface, where it
   runs, whether it edits code or a separate document); how a graph of pieces is serialised,
   stored or versioned; how a component is packaged and distributed on its own (a package per
   component, a catalogue of them, a plugin extension point); whether a template may be authored as a graph instead of TypeScript; how a piece's
   parameter schema maps to a manifest's `values` beyond "may feed"; and the shape of a piece
   that needs a context other than an area (a picture's file, a brand kit). Each is its own
   record when the editor is planned.

## Consequences

- A kit piece added from now on is reviewed against three questions: does it take an area, are
  all its numbers declared parameters with a schema, and does an arrangement measure before it
  places. A pull request that adds a layout constant inside a piece's body is the exception
  that has to say why.
- Tests can drive a piece from its schema's defaults and from its limits, which is what an
  editor's controls will send.
- Templates gain parameters where they had constants; a template's art does not change when
  only the defaults move into a schema.
- The cost is some ceremony per piece (a schema object beside each function), accepted because
  the alternative is rewriting every layout piece when the editor arrives.
