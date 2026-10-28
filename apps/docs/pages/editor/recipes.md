# Recipes

::: info How this page was checked
Every behaviour below was checked on 2026-10-28 on a development build of Tyto on Windows 11, by the desktop test suite that opens a `.recipe` over an installed source plugin and counts the source's fetches: none on open, one on **Run recipe**, none on **Run from here**, one on **Fetch again**, none on an edit below the source. Menus and labels below are the English window's.
:::

A recipe (`.recipe`) is a list of steps, one per line, that fetch rows from a source, filter and reshape them, and plan what to write. Tyto opens a recipe in a tab as a notebook: **under each step, its result**, a table you can read while you write the next line.

## Open one

Open a `.recipe` from **File > Open…** (choose **Recipe** in the dialog's file type list), or click it in the Explorer. The status bar names the kind: **Recipe**. Steps are coloured, and a verb is offered as you type at the start of a line: the generic ones and every verb your installed plugins add.

Problems in a recipe go where a brief's go: underlined in the text and listed in the **Problems** panel.

## When it runs

A recipe runs by itself, but not everything runs at every moment:

- **A pause in typing** runs from the first line you changed down. It stops before a step that fetches from a source: that step and the ones after it say _Fetches on save or Run_ and keep the table they had.
- **Saving** runs the whole recipe, sources included.
- **Run recipe**, from the command bar, runs it all at once. It is your approval: it fetches, and it runs in a folder you have not trusted.
- **In a folder not trusted**, nothing runs until **Run recipe**: each step says _Runs on Run: this folder is not trusted_. Even then the folder's data files stay refused. See [Workspace folder](./workspace-folder.md).

Only the steps that changed run again: a step whose line did not change keeps its table, and an edit below the source asks the source for nothing.

## What a step shows

Under each step is one line, then its table:

- **The line** says what the step answered: _12 rows · 4 columns_, a plan (_Plan: 3 to write to Pauta_), _Failed: see Problems_, or why it did not run.
- **Its age**: when the step ran and how old its data is, such as _ran 2 min. ago · data fetched 3 hr. ago_. The data's age is when the source fetched it, which can be long before the step ran. The ages count up while the tab is open.
- **The table** shows the step's first 20 rows, then how many it leaves out (_30 more rows_). A wide table scrolls sideways inside the step. A long value is cut with an ellipsis; point at it to read it whole, and point at a column's name to see its type.

The table is a preview: the step still works on every row.

## Fold a table

The arrow at the start of the line folds the step's table away and brings it back. Every table starts open. A folded table stays folded while the tab is open, through new runs and when it scrolls out of view; closing the tab or quitting Tyto opens them all again.

## Run from here

**Run from here**, on the line of any step with a table or a plan, runs that step and every step below it, whatever changed. It is **Run recipe** from that step down: it fetches when a step below needs to, and it runs in a folder not trusted.

A source's own cache still answers, so **Run from here** on a source step does not fetch again by itself if the source keeps what it fetched. The command **Run recipe from this cell** does the same from the step your cursor is in, or the nearest one above it.

## Fetch again

**Fetch again** is on the line of a step that fetches: a source, or a `run` of a recipe that holds one. It runs the whole recipe again, and every source fetches instead of answering from its cache. The command **Run recipe, fetching again** does the same from anywhere in the tab.

Use it when the data changed where it lives and the table under the source is older than you want: the line's _data fetched …_ says how old it is.

## Change the language

**Switch the window language** redraws every step's line and table in the new language at once, ages included.
