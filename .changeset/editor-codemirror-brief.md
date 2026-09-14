---
'@tyto/brief-lang': patch
'@tyto/editor': minor
---

CodeMirror 6 with the brief language (TYTO-36).

`@tyto/editor` has an API: `createEditor(parent, options)` mounts an editor and hands back
`getValue`, `setValue`, `onChange`, `setTheme`, `destroy` and the `EditorView` underneath.
The renderer, the demo page and a web build all mount one the same way, and none of them
imports CodeMirror — a React wrapper in `apps/desktop` is a `useEffect` around four methods.

The language is the grammar `@tyto/brief-lang` already ships, configured rather than
described a second time, so the editor and the compiler cannot disagree about what a brief
means. Folding is the one thing this package adds to the tree: a directive with an indented
body folds to its first line, and one with an inline body does not fold at all because there
would be nothing left to show.

`onChange` reports what the author typed and stays quiet when the host writes. `setValue`
carries an annotation the update listener reads, which is what keeps E9.2 from saving the
file it has just opened.

Two themes, swapped through a compartment so switching does not rebuild the state. What they
carry is the chrome and the syntax colours together — a host that could swap one without the
other would get dark text on a dark background.

**Five of the eleven entries in `@tyto/brief-lang`'s highlight table were wrong, and
rendering it is what showed.** Three of them named `directiveMark`, `braceOpen`,
`braceClose`, `markClose`, `boldMark`, `italicMark`, `adjustmentSep` and `valueSep`, and
matched nothing: only a capitalised Lezer rule produces a node, so all eight were spelled
after characters that have no name in the tree. And
`Bold: tags.strong` reaches the two asterisks and not the word between them, because a tag
stops at the first child unless it is written `Bold/...`. Neither mistake throws or warns.
The table is respelled — punctuation through the construct that contains it, emphasis with
`/...` — and `highlight.test.ts` now reads the spans a renderer receives instead of the
table. Restoring the old spelling fails 5 of its 11 cases and 2 of the editor's 20.

`packages/editor/demo/` is the acceptance criterion: `pnpm --filter @tyto/editor demo` opens
the two example briefs the built-in templates ship, with a theme switch and a read-only
toggle. It imports `createEditor` and nothing else, so anything it cannot do, `apps/desktop`
will not be able to do either. `vite build` bundles it in 234 modules with no Node shim,
which is the other half of the criterion.

Not here: vim mode and the command registry (E8.3), lint markers and manifest-driven
completion (E8.2), the template language (E8.4). The keymap is CodeMirror's defaults plus
history and folding, and E8.3 replaces that layer.
