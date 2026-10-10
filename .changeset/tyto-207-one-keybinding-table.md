---
'@tyto/core': minor
'@tyto/editor': minor
'@tyto/plugin-api': minor
'@tyto/desktop': minor
---

TYTO-207 (ADR 0074): every key the window answers now comes from one keybinding table. `@tyto/editor` gains a pure resolver (`parseKey`, `resolveKeybindings`, `keymapSetFor`, `windowBindingsOf`, `shownBindingsOf`) over six closed contexts, `vimMode` and `createEditor` take their vim set as an option, and `setKeymaps` swaps both modes' bindings in place. `plugin-api`'s `editor.keymap` gains an optional `when` and is consumed by the desktop for the first time. `core` gains six codes (`E_KEYBINDINGS_SYNTAX`, `W_KEYBINDING_UNKNOWN_COMMAND`, `W_KEYBINDING_INVALID_KEY`, `W_KEYBINDING_UNKNOWN_CONTEXT`, `W_KEYBINDING_DUPLICATE`, `W_KEYBINDING_LOCKED`). The desktop's `Mod-K` listener becomes a window dispatcher for global keys, registered once. No default key changes.
