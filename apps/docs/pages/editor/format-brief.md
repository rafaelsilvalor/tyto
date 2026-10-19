# Format Brief

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `e3d32e9`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

**Format Brief** (**Alt+Shift+F**) tidies the spacing of the brief in front without changing what it says:

- the text under each `::` block is indented by the same amount — two spaces unless the [`tabSize`](../reference/settings.md#tabsize) setting says otherwise;
- spaces at the end of a line are removed;
- several blank lines in a row become one.

For example, this brief:

```
::titulo Open day···



::lamina
      Guided tours
```

becomes:

```
::titulo Open day

::lamina
  Guided tours
```

(The `···` stands for spaces you cannot see.) The lines between the two `---` are left as they are.

**Ctrl+Z** undoes the whole format in one step.

A brief with a syntax error — the kind the Problems panel lists as `E_SYNTAX` — is left exactly as it is, because Tyto cannot tell where its blocks begin. Fix the error and format again.

## Format every time you save

Set [`formatBriefOnSave`](../reference/settings.md#formatbriefonsave) to `true` in `settings.json` and every **Save** formats the brief first. A brief with a syntax error is saved as it is. [Customize](../customize/) says how to open and change `settings.json`.
