# 0081 — The editor's own panels read the tokens, through CodeMirror's own selectors

Status: accepted · 2026-10-12 · TYTO-258 · closes the open item ADR 0075 left

## Context

ADR 0075 painted the buffer from the window's tokens and left one thing open: "styling the
editor's own panels and tooltips beyond CodeMirror's light and dark defaults". Those defaults
are what a person saw in the find panel, the completion list and the lint tooltip — a grey
`#f5f5f5` or `#333338` panel, buttons drawn with a gradient image, a completion list in the
browser's `monospace` with a `#17c` selected row, and a red, orange or grey underline drawn as an
SVG image with its colour written into the image. None of it moved with the theme a person
picks (ADR 0077).

CodeMirror's base themes write those rules as `&light X` and `&dark X`, which become one
generated class and `X` (`.ͼ2 X`); an editor theme's `X` becomes its own generated class and `X`
(`.ͼ9 X`). The two tie on specificity, and the theme wins only because CodeMirror mounts it after
the base themes. ADR 0075's selection rule found
the cost of a shorter selector: it lost to CodeMirror's longer one whenever the editor had focus.

## Decision

**1. The editor paints CodeMirror's furniture from the same tokens as the buffer.** A role-named
`panels` object sits beside `palette` in `@tyto/editor`'s `theme.ts`, every value one
`var(--tyto-…)`, and `themeTokens` is built from both. The panels and every tooltip are
`surface-raised` with one `hairline` and no shadow, as flat as the rest of the window; a field and
a button sit on `surface` inside a `border`; a focused field takes the window's `focus-ring`.
**No token was added**: every part found a role ADR 0075 already named.

**2. Every rule repeats CodeMirror's own selector, compound and all** —
`.cm-tooltip-autocomplete ul li[aria-selected]`, `.cm-panel.cm-search [name=close]`,
`.cm-button:active` — so it ties with the base theme's and wins by mount order. Within the
editor's theme a later key wins a tie, so a family's general rule comes before its variants
(`.cm-lintPoint:after` before `.cm-lintPoint-warning:after`). **An image is taken off before a
colour is put on**: CodeMirror's buttons are a gradient and its underlines an SVG, and a colour
under an image never shows.

**3. The choices, made on screenshots.** The selected completion is quiet — `selection` behind
the text's own colour — and the characters that matched what was typed are bold
(`weight-strong`) in `text`, on every item. The accent was tried first and read at 2.58:1 on the
dark selection. A search match is outlined, never filled (`accent` for the current one,
`text-muted` for the rest), so the selection and the syntax colours under it still read. A
diagnostic's underline is a wavy text decoration in `error`, `warning` or `info`, and its bar in
the tooltip is `space-2` wide.

**4. Not styled, because nothing mounts it**: the lint panel and the lint gutter, and the arrow a
tooltip can carry. CodeMirror's `dark` flag still picks their colours, and still flips with the
system through `setTheme`.

## Consequences

- `theme.test.ts` holds the shape: every `token()` written in `theme.ts` is in `themeTokens`;
  `theme.ts`, comments aside, writes no hex, colour function, named colour, font stack or `px`;
  and the list of mirrored CodeMirror selectors is present. `e2e/renderer-tokens.test.ts` already
  fails on a name in `themeTokens` that `tokens.css` lacks.
- `e2e/theme.desktop.test.ts` reads the computed colours of the find panel, the selected
  completion and the lint tooltip in light and in dark — a lost tie would leave CodeMirror's
  colour in one scheme and pass a screenshot glance.
- A CodeMirror upgrade that renames a selector makes the rule a dead one, quietly. The e2e above
  catches it for the parts it opens; the rest is caught by reading the base themes on an upgrade.
