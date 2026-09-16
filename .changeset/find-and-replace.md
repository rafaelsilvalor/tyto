---
'@tyto/editor': minor
---

TYTO-109 — find and replace, in the window's own language

`Ctrl+F` did nothing until now: `@codemirror/search` appeared in no `package.json` and nothing
in `packages/editor` imported it. A brief of three hundred lines had no way to find a word in
it.

**The panel is CodeMirror's, the words are the catalogue's.** That was the risk in the card
and it was measured before anything was built: all seventeen strings `@codemirror/search`
renders go through `EditorState.phrases` — eighteen `phrase(` call sites, one of them the
helper, zero literals rendered any other way. So the panel is translated rather than replaced,
and `packages/editor` still ships no words of its own. `EditorOptions.searchPhrases` is the
one place it takes any, because a panel cannot be translated at the point of display the way
a command label is.

**Six commands, on the registry rather than beside it.** `searchKeymap` dropped in whole would
have added seven bindings the command bar knows nothing about, and `bindingsOf` reads its
keystrokes off the registry's set — the bar would have gone on claiming those keys did not
exist while they worked. So `createCommandRegistry` registers find, find next, find previous,
replace, replace all and go to line, and `defaultKeymapSet` binds the four CodeMirror binds.
**Replace gets no keystroke**: the panel has one opener with the replace fields inside it, so a
second binding would be a second name for `Mod-f`, and the bar shows an entry with no key
rather than an invented one.

**Escape and `Mod-g` inside the panel stay CodeMirror's.** A registry binding carries the
default `"editor"` scope and the panel's input is not the editor, so those are a small
panel-scoped keymap beside the registry's rather than a second table.

**In vim mode there is no panel, and search still works.** Finding is `/`, `?`, `n` and `N`,
and `@replit/codemirror-vim` drives the _same_ `SearchQuery` state — so a `/carrossel` typed
in vim is still in the field when the panel is opened later. That holds only while there is
one copy of the package, which is why `@codemirror/search` is now a direct dependency pinned
to the version vim had already resolved. It was already in the shipped bundle as vim's peer,
so this adds no download and no weight.

The phrases live in a state field reading a mutable holder rather than in a compartment, so a
tab opened after a language switch is born in the new language; `restore` re-dispatches for
the other direction, where a tab that was away carries a snapshot from before the switch.
