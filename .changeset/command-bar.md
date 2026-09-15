---
'@tyto/desktop': minor
---

TYTO-103 — the command bar, over the registry the editor already shipped

`@tyto/editor` has had a command registry since E8.3, with a comment saying the order of
`list()` is the order a palette should show. Nothing in `apps/desktop/src` had ever named
`createCommandRegistry`. This wires it and puts a bar in front of it.

**`Mod-K` opens a list of everything the window can do**, filtered as you type, with the
keystroke beside the commands a keymap binds. Enter runs, Escape closes, the arrows move and
wrap, and focus goes back where it came from. Matching folds accents and case and looks at
the id as well as the label, so `previa` finds "Prévia: aumentar" and `preview.zoomIn` finds
it while the window is in the other language.

**Eleven commands**: undo and redo, which the registry brings itself; the five preview
commands, the two slide commands, and — reachable for the first time — the locale switch and
the vim toggle, neither of which any keymap binds. That is what a palette is for: the locale
switch was a `<select>` in the footer and nothing else could reach it.

**The zoom buttons now run commands rather than doing the work.** A button, a key and a bar
entry are three ways to say one id, and a handler that did the work in the click listener
would be a fourth definition of "zoom in" for the others to drift away from.

Two details worth naming. The opener is a window listener and not a CodeMirror binding, so
the bar opens with the preview focused, the panel focused or nothing focused at all — an
unhandled keystroke in the editor bubbles out to it anyway. And **no desktop command
declares an `undo`**, though the registry would take one: `Mod-z` is a single stack shared
with the text, and a zoom on it would sit between two keystrokes somebody is trying to take
back.

The editor now receives the registry, which makes `Mod-z` the registry's undo rather than
CodeMirror's — an app-level command on top of the stack comes off before the text under it.
Thirteen catalogue keys arrive with the bar, and `window.desktop.test.ts`'s pin of "keys that
are not an element's text" grows by all thirteen: a component translates inside its own
render, so its strings never reach the `[data-i18n]` pass that test counts (ADR 0024).
