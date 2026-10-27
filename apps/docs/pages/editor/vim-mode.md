# Vim mode

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `e3d32e9`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

Tyto's editor can take vim's keys: normal, insert, visual and replace modes, motions, and `:` commands.

## Turn it on or off

1. Press **Ctrl+K** to open the command bar.
2. Type `vim` and run **Editor: turn vim mode on or off**.

The same command turns it off again. It has no key of its own; [Keyboard shortcuts](../customize/keybindings-json.md) says how to give it one.

While vim is on, the status bar shows the mode you are in — **NORMAL**, **INSERT**, **VISUAL** or **REPLACE** — and the keys of a command you have started to type. How that badge looks is the [`vimModeStyle`](../reference/settings.md#vimmodestyle) setting, and its colours are in [`statusBarColors`](../reference/settings.md#statusbarcolors).

The choice is remembered: the command writes the [`vimMode`](../reference/settings.md#vimmode) setting, so after a restart the window opens with vim as you left it. You can also write `"vimMode": true` or `false` in `settings.json` yourself; saving the file turns vim on or off at once.

## What changes while it is on

- Vim's own keys win inside the editor: **u** undoes, **Ctrl+R** redoes, **:w** saves, and **:vsplit** splits the editor group, as **Split editor right** does.
- Some of the window's keys are given to vim. **Ctrl+O**, for example, is vim's and no longer opens a file: run **Open…** from the command bar or the **File** menu instead. The command bar shows the keys each command has right now, so a command that lost its key while vim is on shows none.
- **Ctrl+K** still opens the command bar, so every command is still one search away.

## Plugins

Tyto ships some well-known vim plugins inside vim mode. Each one is on while vim is on, unless you switch it off.

**Commentary** comments and uncomments lines with the comment the file's language has: `//` in a brief, `<!-- -->` in a Markdown file.

| Keys                | What they do                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `gcc`               | Comment the line, or uncomment it when it is a comment. A count first, as in `3gcc`, takes that many lines. |
| `gc` and a motion   | The lines the motion covers: `gcj` takes this line and the next, `gcip` the paragraph.                      |
| `gc` in visual mode | The selected lines.                                                                                         |

**.** repeats the last `gc` on the line the cursor is on.

**Surround** adds, changes and deletes the pair around a piece of text: brackets or quotes.

| Keys                      | What they do                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ys`, a motion and a pair | Wraps what the motion covers: `ysiw)` turns `word` into `(word)`, `ys$"` quotes up to the line's end. |
| `yss` and a pair          | Wraps the line, from its first character that is not a space.                                         |
| `ds` and a pair           | Deletes the pair around the cursor: `ds"` turns `"word"` into `word`.                                 |
| `cs`, the old and the new | Changes the pair around the cursor: `cs"'` turns `"word"` into `'word'`.                              |
| `S` and a pair, in visual | Wraps the selection.                                                                                  |

A pair is `(` `)` or `b`, `[` `]`, `{` `}` or `B`, `<` `>`, and the quotes `'`, `"` and `` ` ``. An opening bracket puts a space inside the pair, as in `( word )`, and a closing one does not, as in `(word)`. With `ds` and `cs`, an opening bracket also takes away the spaces just inside the old pair. Quotes are looked for on the cursor's line; brackets anywhere around it. **Escape**, before the pair, cancels.

**.** repeats the last `ys`, `cs` or `ds` with the same pair.

### Switch a plugin off

The [`vimPlugins`](../reference/settings.md#vimplugins) setting names each plugin by its id and says `true` or `false`. A plugin the setting does not name is on, and so is a plugin an installed Tyto plugin adds, by the id that plugin gives it.

```json
"vimPlugins": {
  "commentary": false
}
```

Saving `settings.json` switches it at once. With commentary off, `gc` is vim's own again: it comments a brief's lines with `//`, and does nothing in a Markdown file, which has no line comment.
