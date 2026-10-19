# Themes

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `b039537`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

A **colour theme** paints the window and the editor. Until you choose one, Tyto follows the computer: Tyto Light while the system is light, Tyto Dark while it is dark.

## Choose a theme

1. Run **Preferences: Color Theme** from the command bar.
2. Move through the list with the arrow keys, or type part of a name. The window takes each theme as you reach it, so you see it before choosing.
3. Press **Enter** to keep it, or **Escape** to go back to the theme you had.

**Enter** writes the choice to the [`theme`](../reference/settings.md#theme) setting in `settings.json`. Some themes come twice — with their authors' original colours, and _adjusted_ so every text meets a minimum contrast. [Themes](../reference/themes.md) lists them all.

## One theme for light, another for dark

To keep following the computer with themes of your own, write the setting by hand:

```jsonc
{ "theme": { "mode": "system", "light": "solarized-light-adjusted", "dark": "nord-adjusted" } }
```

`"mode": "light"` or `"dark"` keeps one of the two whatever the computer says.

## Themes from a plugin

A plugin can bring more themes. Install it — `tyto plugin install <folder>`, see [Plugins](./plugins.md) — and open the window again: its themes are in **Preferences: Color Theme** with the others. Switch the plugin off and they leave the list.

Making a theme is in the [plugin author's guide](../extend/plugin-authoring.md).
