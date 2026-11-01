# 0167 — A template spaces its blocks by weight and keeps orphans off its text

Status: accepted · 2026-10-31 · TYTO-516 · extends ADR 0058 (a template reports warnings beside
its frame); a protocol change under ADR 0149 point 4

## Context

The answer slide of the `questao-estrategica` template ("Resposta", "Letra D", then the
explanation) placed each block at a fixed top read off its reference art: the label at 229 px,
the explanation at 526 px. The gap under the explanation was whatever the text left, so a short
explanation sat high on the page and a long one crowded the footer. The gaps over and under the
answer had no relation to each other. The explanation on the maintainer's render also ended on
a line holding one word, "princípio.".

The maintainer asked for three things: the gaps scale together, with the one between the
heading and the explanation kept the largest; the heading and the explanation are centred as one
block; and no paragraph ends on a single word. The size may move to get there, within a limit,
and past the limit the art is still drawn with a warning. He also asked for the fix to be
reusable by any template rather than solved in this one.

**What existed at `origin/main` ff3461bf, read in the code.** `house-style/src/balance.ts`
(TYTO-210) breaks short titles of up to twelve pieces by hand. It chooses the size and avoids a
line ending on a function word. It does not handle paragraphs, and it lives in the house's
package, not in the generic kit. `context.measure` already hands back a text's runs with every
line break decided (ADR 0038), which is enough to read the last line of each paragraph. The
closed list a template may report held one code, `W_TEMPLATE_OVERFLOW`. The Scene IR has
`letterSpacing` in px and no word spacing.

## Decision

**`@tyto/template-kit` gains `rhythm.ts`, with two independent pieces.**

**`spaceByWeight` places blocks between two edges with gaps given as weights.** The caller hands
the room's top and bottom, the blocks' heights and one weight per gap, the two outer gaps
included. The free height is divided by the sum of the weights, so every gap is its weight times
one unit. The gaps grow and shrink together and keep their proportions. Equal outer weights
centre the blocks in the room. Blocks taller than the room get no gaps, and `overflow` says by
how much, for `reportOverflow`.

**`settle` keeps a paragraph from ending on a line of one word.** The caller hands the size the
text fitted at and a layout function that builds the text node at a given setting (a size and a
letter spacing) and says whether everything still fits its room. `settle` reads each paragraph's
last line from `measure`. When the last line holds one word and the paragraph took more than one
line, `settle` tries other settings, in the order a reader notices least:

1. letter spacing at the fitted size, nearest first, out to the limit, tightening and loosening
   alike (a looser line pushes a word down, a tighter one or a smaller size pulls the lone word
   up);
2. each pixel smaller, first plain, then with the same letter spacing.

A setting at which the text no longer fits is skipped. The first setting that clears the orphan
wins.

Words are counted as a reader sees them. Two words joined by a no-break space count as two, so
an author who glues the last pair by hand leaves no orphan. A one-line paragraph of one word is
not an orphan, because nothing wrapped onto it.

**The limits are the caller's, with the house default in the kit.** `ORPHAN_LIMITS` allows a size
at most 8% under the fitted one and letter spacing within 0.01 em either way. A template that
lets a configuration change them declares them as values (ADR 0153).

**Past the limits, the art is drawn and a warning names the word.** `settle` returns the fitted
setting and the word. `reportOrphan(context.report, word)` sends
`{ code: 'W_TEMPLATE_ORPHAN', word }`. `compile` writes the catalog's warning with the artwork,
the format and the range of the directive the artwork came from, as it does for
`W_TEMPLATE_OVERFLOW`. When nothing can measure, nothing is known about the lines. The text is
set as it fitted and no orphan is claimed.

**A report may now carry a word, bounded.** `TemplateReport` becomes a union. The host's schema
accepts an orphan report only with a `word` of 1 to 80 characters (`ORPHAN_WORD_LIMIT`) and
nothing else, so an untrusted plugin still cannot put a message or a range of its choosing into
the author's run. `reportOrphan` cuts a longer word to the limit, so a template never gets its
whole answer refused. A host on protocol 13 would refuse the new code with the whole answer, so
the RPC protocol is 14.

**Word spacing is left out.** The Scene IR has no word spacing. Adding it touches the scene
schema, the layout and both exporters, which is a change of its own and not needed to clear an
orphan here.

**Amended 2026-11-01 (TYTO-521): `settle` rebreaks first.** In a narrow column, such as a
questão's option, neither letter spacing nor a smaller size moved a lone last word: the column
barely narrows as the size drops (measured with the real faces on TYTO-520: 43 to 40 px, and
even a 25% shrink, left it). So `settle` now first breaks the line above one word earlier
(`rebreak`), at the same size and spacing, and only then tries letter spacing and size. The
result carries the rebroken runs in `setting.runs`; a caller that ignores them draws exactly
as before. A rebreak is measured again and refused when the line above would end on one word
itself, or when the moved word does not fit beside the lonely one; it never splits two words
joined by a no-break space. `OrphanLimits.rebreak: false` turns it off. Nothing new crosses
the plugin RPC: the report list and the protocol are unchanged.

## Consequences

- A template states its rhythm as numbers (the questão's answer slide takes 1 : 1.6 : 1, the
  reference's 102 px over the label and 165 px under the answer) and its orphan limits as
  numbers. The next template calls the same two functions and copies no code.
- `W_TEMPLATE_ORPHAN` is a warning on the ok branch (ADR 0013). The frame is drawn and written.
- Installed templates that report it need a Tyto release and a desktop release on protocol 14.
  A template built against the new kit is refused by an older app, so its repository is not
  tagged before both.
- `balance.ts` stays where it is. It hand-breaks titles, which is a different job.
