# settings.json

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `b039537`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

## Open it

Run **Preferences: Open Settings (JSON)** from the command bar or the **File** menu, or click the settings button at the right of the status bar. The file opens in a tab like a brief. A setting you leave out keeps its default, so the file only needs what you change.

## Change a setting

1. Write the setting's name in quotes, a colon and the value, with a comma between settings. Typing a quote offers the names as you go, each with its type.
2. Save (**Ctrl+S**). The change applies at once, with no restart; nothing applies until you save.

```jsonc
{
  "theme": "nord-adjusted",
  // Bigger type in the editor only.
  "codeFontSize": 20,
  "uiFontSize": 15,
}
```

Lines starting with `//` are notes for yourself. Tyto keeps them: when the window itself writes to the file — choosing a theme, zooming — your notes and your order stay where they were.

[Settings](../reference/settings.md) lists every setting, its type, its default and the values it takes.

## A plugin's settings

A plugin you installed may have settings of its own. Each is written with the plugin's name, a dot and the setting's name, and it is suggested and checked like Tyto's own once the plugin has started:

```jsonc
{
  "conector.baseUrl": "https://example.atlassian.net",
}
```

The plugin reads the value when it next works — the next export — and again after every save. A setting of a plugin that is installed but switched off, or that could not start, does nothing; the Problems panel says which plugin it belongs to and that it is not running.

<!-- TYTO-254: checked by e2e/installed-plugins.desktop.test.ts, not by following the steps in the window. -->

## When a value is wrong

A value Tyto cannot use does not stop anything. The Problems panel names it, with its line, and the default applies for that setting alone; the others still apply:

```
W_SETTING_INVALID  Setting 'uiFontSize' is not accepted (Invalid input: expected number, received string); its default applies.
```

If the file itself cannot be read — a missing comma, a brace too many — the panel shows `E_SETTINGS_SYNTAX` with where it stopped, and the window keeps the settings it had until the file is fixed. The file is still saved as you wrote it, so nothing you typed is lost.

<!-- TYTO-322: with settings.json in front the Problems panel says "about this brief"; it means this file. -->
