# Troubleshooting

::: info How this page was checked
Every step and message on this page was seen on 2026-10-19 on a development build of Tyto 0.7.0 (commit `b039537`) on Windows 11, with the window in English and in Brazilian Portuguese. Menus and labels below are the English window's.
:::

## Start with the Problems panel

Almost everything that goes wrong in Tyto is said in the Problems panel — a brief, a template, `settings.json`, `keybindings.json`, a plugin or a font. Each line has a **code**: the first letter says how bad it is, `E_` for an error that stops something and `W_` for a warning that does not. Click a line to go to where it happened. Every code is listed, with what it means, in the [diagnostic codes](https://github.com/rafaelsilvalor/tyto/blob/main/docs/diagnostic-codes.md).

## Common situations

**The preview stopped changing.** The brief has an error: the preview keeps the last drawing that worked until it is fixed. The Problems panel says what and where.

**Export finished but wrote no file.** Read the lines under the progress bar. `E_EXPORT_FONT_UNRESOLVED` naming a font means the template's typeface lacks a face the brief asks for, such as italic; the Problems panel shows the same as `E_FONT_FACE_UNAVAILABLE` on those words. See [Images](../export/images.md#when-an-image-is-not-written).

**A setting does nothing.** Look for `W_SETTING_INVALID` (the value is not one the setting takes, so its default applies) or `E_SETTINGS_SYNTAX` (the file cannot be read, so the window keeps the settings it had). [settings.json](../customize/settings-json.md#when-a-value-is-wrong) explains both. Remember to save: nothing applies before.

**A key does nothing.** It may have been taken away in `keybindings.json`, or vim mode may be on and own it — the command bar shows each command's key as it is right now. See [Keyboard shortcuts](../customize/keybindings-json.md) and [Vim mode](../editor/vim-mode.md).

**A font looks wrong in the window.** `W_FONT_FAMILY_MISSING` means a face named in the settings is not on this computer, and the one Tyto comes with is drawn instead. See [Fonts and zoom](../customize/fonts-and-zoom.md).

**Something changed after installing a plugin.** Switch it off with `tyto plugin disable <name>` and open the window again. If the trouble goes, the plugin is the cause. See [Plugins](../customize/plugins.md).

**`tyto render` stops with `E_FORMATS_READ`.** The file `--formats-file` names is not there. Check the path, or leave the option out: without it, the `formats.yaml` in the folder you run from is read, and without that, the sizes that come with Tyto; see [Command line](../command-line/#before-the-first-render-sizes-and-templates).

## The log

Tyto writes a log of what the window did: when it started, each time `settings.json` or `keybindings.json` changed, and the warnings it met. **Help ▸ Open the log folder** opens the folder; the file is `tyto.log`. It is in the `logs` folder of your version's folder — see [Where Tyto keeps your things](../get-started/install.md#where-tyto-keeps-your-things).

Each line has the time, the level (`INFO`, `WARN`), the version and the system, and what happened:

```
2026-10-19T14:05:49.045Z | INFO | 0.7.0 | win32 | app started
2026-10-19T14:06:17.155Z | WARN | 0.7.0 | win32 | settings.json: Setting 'uiFontSize' is not accepted (Invalid input: expected number, received string); its default applies.
```

## Reporting a problem

Open an issue on the project's [GitHub page](https://github.com/rafaelsilvalor/tyto/issues) with:

1. **What Tyto you have.** **Help ▸ About Tyto** shows the version, the system, how many templates it found and which template folder is in use. Copy those four lines.
2. **What you did and what happened**, step by step, and what you expected instead.
3. **The codes in the Problems panel**, copied as they are.
4. **The log**, `tyto.log` from the log folder. Read it before you send it.
5. **The brief**, if the problem is with one — or a smaller brief that shows the same problem. If it uses your own template, the template's folder too.
