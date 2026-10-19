# Fonts and zoom

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `b039537`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

## Make everything bigger: zoom

**Zoom in** (**Ctrl+=**), **Zoom out** (**Ctrl+-**) and **Reset zoom** (**Ctrl+0**) grow or shrink the whole window — text, buttons, panels — in steps. They are also in the **View** menu. The zoom is kept in the [`zoom`](../reference/settings.md#zoom) setting, so the window opens at the same size next time; **Reset zoom** takes the setting out again.

## Change the text sizes

Two settings in `settings.json` set the base size of the text, in pixels:

- [`codeFontSize`](../reference/settings.md#codefontsize) — the text you write: briefs, `settings.json`, templates.
- [`uiFontSize`](../reference/settings.md#uifontsize) — everything else: menus, tabs, panels, the status bar.

```jsonc
{
  "codeFontSize": 20,
  "uiFontSize": 15,
}
```

## One part of the window only

[`fontSizes`](../reference/settings.md#fontsizes) sets a size for one **area** of the window and leaves the rest on its base:

```jsonc
{ "fontSizes": { "problems": 16, "statusBar": 13 } }
```

The areas are the editor, the settings tabs, the suggestion list, the problems panel, the command bar, the title bar, the tabs, the panel headers, the status bar and the queue; [`fontSizes`](../reference/settings.md#fontsizes) gives each one's name.

## Change the typeface

[`codeFontFamily`](../reference/settings.md#codefontfamily) and [`uiFontFamily`](../reference/settings.md#uifontfamily) put a face of your own in front of the one Tyto comes with, and [`fontFamilies`](../reference/settings.md#fontfamilies) does it for one area. Write the face's name as your computer knows it.

A face the computer does not have is reported in the Problems panel, and the one Tyto comes with is drawn instead:

```
W_FONT_FAMILY_MISSING  This font is not installed; the bundled one is drawn instead: fontFamilies.editor "No Such Face"
```

These settings change only the window. The fonts of an artwork are the template's.
