# Keyboard shortcuts

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `b039537`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

Every key runs a command, and `keybindings.json` changes which. Open it with **Preferences: Open Keyboard Shortcuts (JSON)**. It starts as an empty list with three lines of notes on how to fill it.

## Give a command a key

Add an entry with the `key` and the command's `id`. The command bar does not show ids; [Commands](../reference/commands.md) lists each command's id.

```jsonc
[
  // Vim on and off with one key.
  { "key": "ctrl+alt+v", "command": "editor.toggleVim" },
]
```

Save, and the key works at once. The command bar shows the new key beside the command.

## Only in some places: `when`

A `when` limits a key to a **context** — while the editor has focus, while vim is in normal mode, while the command bar is open. [Keyboard shortcuts](../reference/keyboard-shortcuts.md#contexts) lists the contexts.

```jsonc
// Go to Block on Ctrl+Alt+B, but only while vim is in normal mode.
{ "key": "ctrl+alt+b", "command": "editor.goToBlock", "when": "vim.normal" }
```

With vim off, **Ctrl+Alt+B** does nothing; with vim on and in normal mode, it opens Go to Block.

## Take a key away

Put a `-` before the command's id to remove a key it has by default:

```jsonc
// Format Brief only from the command bar.
{ "key": "alt+shift+f", "command": "-editor.formatBrief" }
```

**Alt+Shift+F** then does nothing, and the command bar shows **Format Brief** with no key.

## Ctrl+K stays

**Ctrl+K** (**Cmd+K** on macOS) always opens the command bar: it is how you reach every command, including the ones that open this file. An entry that gives it to another command, or takes it away, is refused and the Problems panel says so:

```
W_KEYBINDING_LOCKED  Key 'ctrl+k' cannot run 'editor.save': it opens the command bar, the way to every command.
```

## When an entry is wrong

Each mistake is listed in the Problems panel with its line, and the other entries still apply. An id no command has is `W_KEYBINDING_UNKNOWN_COMMAND`; a file that is not a list of `{ "key", "command" }` entries is `E_KEYBINDINGS_SYNTAX`, and then the window keeps the keys it had until the file is fixed.

Every default key is in [Keyboard shortcuts](../reference/keyboard-shortcuts.md).
