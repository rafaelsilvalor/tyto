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

Tyto ships some well-known vim plugins inside vim mode. Each one is on while vim is on, unless you switch it off; sneak is the one exception, off until you switch it on.

| Plugin              | Id                    | Starts |
| ------------------- | --------------------- | ------ |
| Commentary          | `commentary`          | on     |
| Surround            | `surround`            | on     |
| ReplaceWithRegister | `replaceWithRegister` | on     |
| Exchange            | `exchange`            | on     |
| Unimpaired          | `unimpaired`          | on     |
| Indent object       | `indentObject`        | on     |
| Entire buffer       | `entireBuffer`        | on     |
| Sneak               | `sneak`               | off    |
| Highlighted yank    | `highlightedYank`     | on     |
| System clipboard    | `systemClipboard`     | on     |

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

**ReplaceWithRegister** replaces text with what you yanked, and keeps it yanked.

| Keys                | What they do                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| `gr` and a motion   | Replaces what the motion covers: after `yiw` on one word, `griw` on another puts the first in its place. |
| `grr`               | Replaces the line. A count first, as in `3grr`, takes that many lines.                                   |
| `gr` in visual mode | Replaces the selection.                                                                                  |
| `"a` before `gr`    | Takes register `a` instead of the last yank.                                                             |

The register is left as it was, so `p` afterwards still pastes what you yanked, and **.** repeats the last `gr`.

**Exchange** swaps two pieces of text: mark one, then mark the other.

| Keys               | What they do                                                                         |
| ------------------ | ------------------------------------------------------------------------------------ |
| `cx` and a motion  | Marks what the motion covers; the second `cx` swaps it with the first: `cxiw` twice. |
| `cxx`              | Marks the line.                                                                      |
| `X` in visual mode | Marks the selection.                                                                 |
| `cxc`              | Forgets the mark.                                                                    |

The first piece stays marked in the selection colour until the second. One **u** undoes the swap. With exchange off, visual `X` deletes the selected lines again, as in vim.

**Unimpaired** adds blank lines and moves lines, in normal mode.

| Keys               | What they do                                                     |
| ------------------ | ---------------------------------------------------------------- |
| `[` then **Space** | Adds a blank line above the cursor's line; the cursor stays put. |
| `]` then **Space** | Adds a blank line below.                                         |
| `[e`               | Moves the line up.                                               |
| `]e`               | Moves the line down.                                             |

A count first adds that many lines, or moves that many places. The rest of vim-unimpaired (buffers, files, options) is not part of Tyto.

**Indent object** and **Entire buffer** are text objects: keys you type after an operator such as `d`, `c`, `y` or `gc`, or in visual mode to select.

| Keys | What they cover                                                                          |
| ---- | ---------------------------------------------------------------------------------------- |
| `ii` | The block of lines at the cursor's indent or deeper: `dii` deletes it, `vii` selects it. |
| `ai` | The same block and the line above that opens it.                                         |
| `ae` | Every line of the file: `yae` yanks it all.                                              |
| `ie` | Every line but the blank ones at the start and the end.                                  |

**Sneak** jumps to two characters, in normal mode. It is off until you switch it on, because it takes vim's own `s` and `S`.

| Keys                   | What they do                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `s` and two characters | Jumps to the next place they appear: `sab` to the next `ab`.        |
| `S` and two characters | Jumps to the previous place.                                        |
| `;` and `,`            | Repeat the last sneak, or the last `f` or `t`, forward or backward. |

**Highlighted yank** marks the text you yank for a moment, so you see what `y` took.

### The system clipboard

With **System clipboard** on, `y` copies to the system clipboard too, so what you yank in Tyto pastes in any other program. Only a plain `y` does: `"ay`, into a named register, does not, and neither do `d`, `c` or `x`.

Text you copy in another program arrives when the editor gets focus: click the editor, or come back to Tyto's window, and `p` pastes it.

### Switch a plugin off

The [`vimPlugins`](../reference/settings.md#vimplugins) setting names each plugin by its id and says `true` or `false`. A plugin the setting does not name has the default in the table above, and a plugin an installed Tyto plugin adds is on, by the id that plugin gives it.

```json
"vimPlugins": {
  "commentary": false,
  "sneak": true
}
```

Saving `settings.json` switches it at once. The file replaces the whole object, so write only the plugins you change. With commentary off, `gc` is vim's own again: it comments a brief's lines with `//`, and does nothing in a Markdown file, which has no line comment. With sneak on, `s` and `S` in normal mode are sneak's; `cl` and `cc` still do what vim's own `s` and `S` did.
