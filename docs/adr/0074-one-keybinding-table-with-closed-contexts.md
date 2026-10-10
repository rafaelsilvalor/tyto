# 0074 — One keybinding table, with closed contexts, that the person's file will edit

Status: accepted · 2026-10-10 · TYTO-207

## Context

Before this ADR the window's keys lived in four places that did not know about each other:

- `defaultKeymapSet` and `vimKeymapSet` in `@tyto/editor`, and `desktopKeymapSet` in
  `apps/desktop/src/renderer/commands.ts`, each a CodeMirror keymap of command ids.
- `vimMode()` hard-coded `vimKeymapSet`; the editor swapped one input compartment between it
  and the desktop set.
- `Mod-K` was a raw `keydown` listener on the window in `main.ts`.
- `plugin-api` had an `editor.keymap` point (`bindings`, `mode: normal | vim`) that a plugin
  could register into and nothing consumed.

Two rules governed them and were written down only in code comments. **TYTO-101**: the
command bar's window listener is registered exactly once for the life of the window, because
`applyLayout` runs on every rearrange and a second listener toggles the bar twice per keypress.
**TYTO-124**: no File menu item carries an accelerator, because a menu accelerator is handled
by the browser process before the page and would override the page's keys unconditionally —
vim mode included, where `Ctrl-N` and `Ctrl-O` belong to the engine.

TYTO-207 asks for the file VS Code and Zed have: a keybindings file the person edits. It ships
in two pull requests. PR A (this ADR's first half) builds the mechanism without the file and
changes no key; PR B reads the file into it.

## Decision

**1. The file's shape, decided now for PR B: VS Code's list.** `[{ key, command, when? }]`,
JSON with comments, and `-command` removes a binding the layers below made. Zed's map of
contexts to `{ key: command }` was the alternative. The list wins on three counts: every entry
has its own range, so a diagnostic lands on the line that caused it; removing a default is an
entry like any other rather than a `null` in someone else's map; and `when` stays a closed name
instead of growing into Zed's context-expression language.

**2. Six contexts, and no others.** `editor`, `vim.normal`, `vim.insert`, `mode.desktop`,
`commandBar`, `panel`, listed in `@tyto/editor` (`KEYBINDING_CONTEXTS`). `editor` is focus in
the editor in either input mode; `vim.normal` is vim on and the engine not in insert mode
(visual mode counts as normal); `vim.insert` is insert mode; `mode.desktop` is the editor with
vim off; `commandBar` is the bar open; `panel` is focus in a panel other than the editor with
the bar closed. **A binding with no `when` is global** and runs wherever focus is. An unknown
`when` is `W_KEYBINDING_UNKNOWN_CONTEXT` and costs that entry.

**3. Two runners, one table.** The four editor contexts become CodeMirror bindings, installed
per input mode as before; a `vim.*` binding's `run` asks the engine for `insertMode` and
returns `false` in the other half, so the key falls through to the engine and to the bindings
after it. Global, `commandBar` and `panel` bindings go to **one** window `keydown` dispatcher,
which replaced the `Mod-K` listener and is registered once, from `load()` (TYTO-101, now
written here). It reads the table at the keystroke, so a table that changes needs no second
listener. A key the editor already took (`defaultPrevented`) is left to the editor, except the
bar's own key, which the old listener always answered. **Nothing becomes a menu accelerator**
(TYTO-124, now written here).

**4. One pure resolver.** `packages/editor/src/keybindings.ts` imports no CodeMirror, DOM or
Node. `parseKey` reads the file's syntax; `resolveKeybindings({ builtIn, plugins, user,
commands, platform })` answers the table, highest precedence first, and `Diagnostic[]` with each
entry's range; `keymapSetFor(table, vim)` is the CodeMirror half for one input mode,
`windowBindingsOf(table)` the dispatcher's, and `shownBindingsOf` what the bar prints. The three
sets became the built-in layer with the context each was always in: `vimKeymapSet` is `editor`
(save and render, in both modes), the rest of the desktop set is `mode.desktop`, and `Mod-K` is
global. `vimMode()` takes its set as an option instead of hard-coding it.

**5. Precedence: built-in, then each plugin's `editor.keymap` in activation order, then the
person's file.** The desktop consumes `editor.keymap` from PR A on, through `plugins:keymaps`.
The point gains an optional `when`; `mode` stands in for a missing one (`normal` is
`mode.desktop`, `vim` is `vim.normal`, neither is global). A higher entry on the same key
**removes** the lower one wherever its context covers the lower's (global covers everything;
`editor` covers the three editor contexts), so the bar never shows a key that now runs
something else. Two entries of one source on the same key and context are
`W_KEYBINDING_DUPLICATE`, and the first applies.

**6. Vim.** A key with no modifier types a character everywhere but vim's normal mode, so a
plugin or user entry without a modifier is valid only with an explicit `when: vim.*`; function
keys type nothing and are exempt. Table bindings sit ahead of the engine in the keymap order,
and the engine's own keys (`u`, `Ctrl-r`, `/`) stay the engine's: the built-in layer binds none
of them.

**7. The bar's key is locked.** `-commandBar.toggle`, or any entry that puts another command on
`Mod-K` (spelled `ctrl+k` on Windows or `cmd+k` on macOS as well), is `W_KEYBINDING_LOCKED` at
the entry's range and refused. A second key for the bar is fine. The bar is the way to every
command, including whatever fixes a broken binding.

**8. Key syntax.** Lowercase, `+`-separated: modifiers `ctrl`, `shift`, `alt`, `cmd` or `meta`,
and `mod` (Cmd on macOS, Ctrl elsewhere); key names are a single character, `f1`–`f24` and a
closed list of named keys (`enter`, `escape`, `pageup`…). It is normalised to CodeMirror's
notation in the fixed order Mod, Ctrl, Meta, Alt, Shift, so two spellings compare equal.
Two-key sequences (`ctrl+k ctrl+c`) are `W_KEYBINDING_INVALID_KEY`: the dispatcher cannot run
one, and a key that works in the editor and not in a panel is worse than none.

**9. Codes.** `core` gains `E_KEYBINDINGS_SYNTAX`, `W_KEYBINDING_UNKNOWN_COMMAND`,
`W_KEYBINDING_INVALID_KEY`, `W_KEYBINDING_UNKNOWN_CONTEXT`, `W_KEYBINDING_DUPLICATE` and
`W_KEYBINDING_LOCKED`. None is fatal: resolving never fails, and each costs only its entry.

## Consequences

- PR A changes no key. `e2e/keybindings.desktop.test.ts` presses every key the window bound
  before, with vim off and in vim normal and insert mode, and was run against `origin/main`
  first: 10 of 11 passed there, the eleventh being the plugin binding that did not exist yet.
- **One behaviour moves, on purpose.** The editor has one input layer, and a tab now takes it
  when it is shown (`restore`). Before, a tab built before vim was toggled kept the mode it was
  born in while `isVimMode()` answered the other one; the table needs every tab to follow it,
  and the vim toggle follows for the same reason.
- `Ctrl+Shift+K` no longer opens the bar. The old listener matched any `Ctrl` or `Cmd` with `k`
  and ignored Shift; the dispatcher matches the key the table names, as CodeMirror does.
- Until PR B the resolver's diagnostics for plugin layers go to the log, one `warn` line each.
- PR B reads `keybindings.json` (beside `settings.json`, per-version, ADR 0032) into the `user`
  layer, mints `E_KEYBINDINGS_SYNTAX`, shows every code in the problems panel at its range, and
  adds the command that opens the file in a tab.
