# 0088 — Indent guides are our own; editor config arrives through theme:current and a compartment

Status: accepted · 2026-10-16 · TYTO-293 · amends ADR 0089 (decision 3, the token count)

## Context

Rafael asked on 2026-10-14, with a VS Code screenshot, for vertical lines showing how deep each
line is indented, so the eye can follow a block. In a brief indentation is meaning — an indented
line belongs to the directive above it (`BodyLine` in `brief.grammar`) — and the editor drew
none (no indentation-marker extension in `packages/editor` at `1cc9e8e`).

Two ways were open. The maintained-looking package for CodeMirror 6,
`@replit/codemirror-indentation-markers`, had not published in 27 months when the card was
planned, and the house adds no dependency for what a hundred lines do (ADR 0075's reasoning, and
`json-language.ts`'s for JSON). It also reads the syntax tree for its levels, which the JSON tabs
and the template mode's manifest buffer (a `plain` language) have none of.

The editor had one kind of setting already, and none that the desktop changes at runtime:
`setTheme` and `setVimMode` are calls a host makes, each a compartment reconfigured on every view.
The desktop's look-and-feel settings (`iconStrokeWidth`, `statusBarItems`, `statusBarColors`,
`vimModeStyle`) ride on `theme:current`'s answer, which the window asks for on every
`settings:changed` (ADR 0091).

## Decision

**1. The guides are an extension of `@tyto/editor`'s own** (`indent-guides.ts`, no dependency).
Pure functions do the work and are exported for tests: `indentLevels` (a line's leading
whitespace in units of the state's `indentUnit`, a tab to the next stop), `guideRuns` (for each
level, each longest run of lines at least that deep) and `activeGuide`. A CodeMirror `layer`
behind the text draws one element per guide per run — `.cm-indent-guide`, with `data-level` —
at column `(level - 1) × unit`, from the top of the run's first line block to the bottom of its
last, so a guide is one straight line through wrapped rows and blank lines. Only the viewport and
1,000 lines either side are read for one drawing.

**2. The levels come from the text, not the syntax tree.** A blank line takes the lower of the
nearest non-blank levels above and below (a missing side counts as 0), so a guide runs on through
an empty line inside a block and stops at one between two blocks. TYTO-294 (blank lines inside a
block, in the grammar) does not change this rule.

**3. The guide of the block holding the cursor is drawn in a stronger colour.** The block of the
cursor line's level; on a line followed by a deeper one — `::lamina`, a discipline name — the
block that line opens. None at the top level.

**4. Two tokens, 40 → 42.** `--tyto-indent-guide` is the theme's `border`, decorative and held to
no floor (1.59:1 and 1.60:1 on the editor's surface in Tyto Light and Tyto Dark).
`--tyto-indent-guide-active` is the theme's `text-disabled` where that reads **3:1 or better on
`surface`** (WCAG's floor for a graphical object) **and ΔE2000 10 or more from the guide** (ADR
0089 decision 8's "seen at a glance"); elsewhere `text-disabled` with its HSL lightness moved, as
ADR 0089 decision 4 moves a colour, to the first value meeting both, and the theme's `derived`
names it. **Held in every theme Tyto ships, originals included**, as the vim badge is: the guide
is Tyto's, not upstream's, so moving it never makes a theme a pair, and both of a pair draw the
same guides (`border`, `surface` and `text-disabled` are never adjusted). Measured: Tyto Light
`#8e8f94` 3.09:1 (2.83 over the active line's background), Tyto Dark `#878a98` 4.08:1; 16 of the
20 pack themes needed the move — Nord, Solarized and Gruvbox because `text-disabled` _is_
`border` there — the lowest after it 3.00:1 (Tokyo Night).

**5. `indentGuides` is a setting, delivered on `theme:current` and applied through a
compartment.** A boolean through the `configuration` point (ADR 0073), default `true`, with its
two `options` so the settings tab suggests and explains them (ADR 0092), and commented out with
its values in a newly created `settings.json`. It rides on `theme:current`'s answer as the
status bar's settings do, and the window calls `setIndentGuides` on the editor — a compartment in
every document's shared extensions, reconfigured on every view and brought up to date in
`restore`, as the theme's is — and on the template mode, whose buffers are editors of their own.
So brief tabs, JSON tabs (settings, keybindings, snippets) and the template mode's two buffers all
get the guides, from one extension: the JSON tabs needed nothing, since `blank(doc, 'json')` is
built from the same shared list.

## Consequences

- An editor setting the desktop changes at runtime has a shape to copy: a field on
  `theme:current`, a setter on `EditorHandle` over a compartment, and the same call to the template
  mode.
- **The active colour is Rafael's to choose by looking**, from a sheet of `text-disabled`,
  `text-muted` and the accent at 60 % over the surface; the default is `text-disabled` until he
  does, and another choice is the token's value in `tokens.css` and the theme files.
- The decorative guide follows `border` and is faint where `border` is: 1.12:1 in Tokyo Night and
  1.24:1 in One Dark, whose `border` sits darker than the surface.
- A blank line at the edge of the 1,000-line window reads its missing neighbour as level 0, and a
  block longer than the window may lose its active colour while the cursor is outside it.
