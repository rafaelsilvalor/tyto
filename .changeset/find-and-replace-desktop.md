---
'@tyto/desktop': minor
---

TYTO-109 — the search panel speaks the window's language

Twenty-three catalogue keys arrive with find and replace: seventeen for the panel itself and
six command labels. `src/renderer/search-phrases.ts` maps each of CodeMirror's own keys — the
English string _is_ the key, so a missing entry falls back to itself and shows English on a
Portuguese screen — to a catalogue key, written out rather than derived.

`applyLocale` in `main.ts` replaces two call sites that set `state.locale` and repainted.
Everything this app draws is re-read by `repaint`; the panel is not, because it is
CodeMirror's DOM, so the editor is told separately.

`NOT_ELEMENT_TEXT` in `e2e/window.desktop.test.ts` grows by all twenty-three, its largest
single growth. The coverage it gives up is replaced twice: `search-phrases.test.ts` holds
every key to a catalogue entry that differs between the two languages, and
`packages/editor/src/search.test.ts` mounts the real panel and reads the words back off it.

**This is a second file rather than a second line in the editor's changeset**, and that is
not style. Changesets v3 treats a private package as _ignored_, and refuses a changeset that
names both an ignored and a published package: `Mixed changesets that contain both ignored
and not ignored packages are not allowed`. One file naming both took the release workflow
down on `main` (TYTO-0).
