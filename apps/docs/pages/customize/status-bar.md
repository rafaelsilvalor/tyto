# The status bar

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `b039537`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

The status bar is the strip along the bottom of the window. [Tour of the window](../get-started/window-tour.md) names what is on it.

## Choose what shows

[`statusBarItems`](../reference/settings.md#statusbaritems) is the list of items to show. An item you leave out is hidden:

```jsonc
{ "statusBarItems": ["commandBar", "cursorPosition", "problems", "export", "settings"] }
```

With this list the bar keeps the command bar button, the cursor position, the problems count and the export and settings buttons, and drops the rest — the area buttons, the template name, the queue and plugins buttons. Items keep to their side of the bar — the command bar button on the left; the cursor position, problems, export and settings on the right — and the order of the list is their order within that side. The setting's page lists every item's name.

## Colours

[`statusBarColors`](../reference/settings.md#statusbarcolors) gives the bar colours of its own, over whatever theme is in use: its background and text, a button under the pointer, a button that is on, the text of each item, and the colours of vim's mode badge.

```jsonc
{ "statusBarColors": { "background": "#204060" } }
```

A colour that makes the bar's text hard to read in one of your themes still applies, and the Problems panel says so with `W_SETTING_LOW_CONTRAST`, naming the theme and the contrast it measured.

How vim's mode is shown — a coloured badge, a coloured strip along the top of the bar, or the whole bar in the mode's colour — is [`vimModeStyle`](../reference/settings.md#vimmodestyle). [Vim mode](../editor/vim-mode.md) says when the badge shows.
