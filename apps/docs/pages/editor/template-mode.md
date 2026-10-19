# Template mode

::: info How this page was checked
Every step was followed on 2026-10-19 on a development build of Tyto 0.7.0 (commit `e3d32e9`) on Windows 11, once with the window in English and once in Brazilian Portuguese. Menus and labels below are the English window's.
:::

Template mode edits a template's two files — `manifest.yaml` and `template.html` — beside a drawing of every format the template has, redrawn as you type. It covers the window; your brief tabs stay open behind it.

It works on templates written as `manifest.yaml` and `template.html`. A template whose layout is a `template.ts` opens as a note saying it cannot be edited here. What goes in the two files is the [template author's guide](../extend/template-authoring.md); this page is about the window.

## Open a template

- **Edit template…** (command bar, or the **File** menu) asks for a template's folder and opens it.
- **New template…** opens the mode with the cursor in the **New template name** field. Type a name and click **Create**: Tyto writes a working template of that name into your [templates folder](../templates/templates-folder.md) — the two files and an `examples` folder with a brief for it — and opens it.

Inside the mode, **Open another…** switches to a different folder, and the name field with **Create** makes another new template.

## Edit and see

1. Click **manifest.yaml** or **template.html** above the editor to switch between the two files. A dot after a file's name means it has unsaved changes.
2. Type. The right side redraws every format the template declares, each labelled with its name and size.
3. Problems in either file are listed under the editor.

The drawing needs a **sample brief**: a `.brief` file in an `examples` folder inside the template's folder. With more than one, the **Sample brief** list picks which to draw. With none, the right side says _No brief in examples/ — the preview needs one._ — add one, then use **Open another…** to open the folder again.

## Save and close

**Save** writes both files. Any brief open in the window that uses this template is checked and drawn again at once: a mistake in the template shows up in that brief's Problems panel, and its preview keeps the last drawing that worked until the template is fixed.

**Close** goes back to your briefs. If either file has unsaved changes, Tyto asks first: **Keep editing** or **Discard**.

The window remembers an open template mode across a restart, as it remembers tabs.
