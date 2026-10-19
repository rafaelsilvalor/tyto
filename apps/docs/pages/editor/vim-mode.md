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

::: warning Vim mode is not remembered
Nothing turns vim on at start: there is no setting for it, and the window always opens with vim off. Run the command again after each restart.
:::

<!-- TYTO-333: vim's state is held in memory only (editor.toggleVim flips it). -->

## What changes while it is on

- Vim's own keys win inside the editor: **u** undoes, **Ctrl+R** redoes, **:w** saves, and **:vsplit** splits the editor group, as **Split editor right** does.
- Some of the window's keys are given to vim. **Ctrl+O**, for example, is vim's and no longer opens a file: run **Open a brief…** from the command bar or the **File** menu instead. The command bar shows the keys each command has right now, so a command that lost its key while vim is on shows none.
- **Ctrl+K** still opens the command bar, so every command is still one search away.
