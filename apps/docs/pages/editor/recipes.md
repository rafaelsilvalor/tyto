# Recipes

::: info How this page was checked
Every behaviour below was checked on 2026-10-28 on a development build of Tyto on Windows 11, by the desktop test suite that opens a `.recipe` over an installed source plugin and counts the source's fetches: none on open, one on **Run recipe**, none on **Run from here**, one on **Fetch again**, none on an edit below the source. **Apply** was checked on 2026-11-07 by the same suite, applying the example recipe plugin's plan and reading each operation's mark. The Table view was checked on 2026-11-07 by a suite that scrolls a 5,000-row table to its last row, sorts it and filters it; copying was checked by unit tests, not in the window. Opening a step in a tab was checked on 2026-11-08 by the same suite, drawing the 5,000 rows full size and closing the recipe. Opening a `run` step was checked on 2026-11-08 by the same suite as Apply, reading the included recipe's tables and plan. Writing briefs with `to-brief` was checked on 2026-11-08 by a test of the desktop's main process that plans three rows into a folder, applies the plan and renders each brief with `tyto render`, not in the window. Sending with `call` was checked on 2026-11-11 by tests of the shared recipe runner against a stand-in endpoint, not over the network and not in the window. Menus and labels below are the English window's.
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

<Screenshot
  scene="recipe-notebook"
  alt="A recipe after Run recipe: under its source step, the line 30 rows · 5 columns with its age and the Run from here and Fetch again buttons, a table of the first 20 rows and 10 more rows below it; the where step under it shows its own line and table."
/>

Under each step is one line, then its table:

- **The line** says what the step answered: _12 rows · 4 columns_, a plan (_Plan: 3 to write to Pauta_), _Failed: see Problems_, or why it did not run.
- **Its age**: when the step ran and how old its data is, such as _ran 2 min. ago · data fetched 3 hr. ago_. The data's age is when the source fetched it, which can be long before the step ran. The ages count up while the tab is open.
- **The table** shows the step's first 20 rows, then how many it leaves out (_30 more rows_). A wide table scrolls sideways inside the step. A long value is cut with an ellipsis; point at it to read it whole, and point at a column's name to see its type.

The table is a preview: the step still works on every row. To see all of them, see [Show a table whole](#show-a-table-whole).

## Show a table whole

A `show table` line draws every step from it down in the **Table view** instead of the preview: all of the table's rows, however many, in a box of twelve rows that scrolls. Only the rows in sight are drawn, so a table of thousands scrolls as quickly as one of ten. `show summary` draws the same view with a **Grand total** line under it, summing each number column.

- **Sort**: click a column's name to sort by it, again to reverse it, a third time to go back to the recipe's order. The sort is the view's: the next step still reads the rows in the order the recipe made them.
- **Filter**: type in _Filter rows_ to keep the rows that hold the text in any column shown, without minding case or accents. _Rows: 111 of 5,000_ says how many it kept. A Summary's totals add up the rows the filter keeps.
- **Columns**: the **Columns** button lists the columns with a box each; clear one to hide it. A hidden column is not searched by the filter. The last column shown stays.
- **Select and copy**: click a cell, then Shift-click another to select the rectangle between them; Ctrl+A (⌘A on macOS) in the table selects every row. **Copy**, or Ctrl+C, puts the selection on the clipboard as tab-separated text that pastes into a spreadsheet as cells, whole values included, up to 50,000 rows.

Numbers are aligned to the right and grouped, dates are written in the window's language, and a `link` column's web addresses (`http` and `https`) open in your browser. An address of any other kind stays plain text: Tyto never hands it to the system.

## Show rows as a board

`show board by=status` draws every step from it down as a **Board**: one column for each value of the `status` column, with how many rows hold it, and a card for each row. A whole line reads `show board by=status order="To Do,In Progress,Done" fields=title,assignee`.

- **`by=`** names the column whose values make the columns. Values are grouped without minding case or accents, so `Done` and `done` are one column, named as the first row wrote it. Rows with no value go in a **(none)** column at the end.
- **`order=`** lists the values that come first, in that order; the others follow in the order they first appear. The list can be kept in a data file beside the recipe, as `order=@./board.json#/order`, a JSON list of words.
- **`fields=`** names the columns a card shows, the first as its title. Without it, a card shows the first three columns besides `by=`.

A column draws fifty cards; **50 more** draws the next ones. _Filter rows_ works as in the Table view, and the columns count only the rows it keeps. The board is for reading: dragging a card changes nothing. To change a status, write the step that does it, which shows its plan before anything is written.

## Show rows on a calendar

`show calendar date=due` draws every step from it down as a **Calendar**: each row on the day of its `due` column. A whole line reads `show calendar date=due time=hour span=week`.

- **`date=`** names the column that places a row: a date, or a date and time. A date and time with a zone (`2026-11-09T01:30Z`) falls on the day it is in the recipes' time zone (the `recipeTimeZone` setting, your computer's when unset), so a delivery at 22:30 in São Paulo is on that evening, not the next day.
- **`time=`** names a column with the hour, as `14:30` or a date and time. A day lists its rows by it; without it, by the hour in `date=` when there is one.
- **`span=`** is `week` or `month`, a month when absent. The **Week** and **Month** buttons switch between them.

The calendar opens on the week or month that holds today; **Previous** and **Next** move a span at a time, and _3 earlier · 12 later_ says how many dated rows lie outside it. A day shows its first three rows and **+2 more** for the rest. Rows with no date, or a date that names no day (such as `soon`), are never dropped: they are listed under the calendar as _No date (14)_, a wrong date written beside its row. The week starts on the day your language starts it. _Filter rows_ works as in the Table view. The calendar is for reading: a row is not moved by dragging it.

## Show rows as loose cards

`show cards fields=title,owner,due` draws every step from it down as **loose cards**: a grid of cards of one size, each showing the columns `fields=` names, the first as its title. Without `fields=`, a card shows the first four columns.

The grid draws 48 cards; **252 more** draws the next ones. _Filter rows_ works as in the Table view. Click a card (or press Enter on it) to open it: it shows **every column of the row**, those the card leaves out included, and where the row came from: its source, the row's id at the source, when it was fetched, and its link, the first `link` column holding a web address. A long value is shown whole up to 10,000 characters. A row made by `group` names `group` as its source and the group's key as its id. Escape or **Close** closes it. The cards are for reading: nothing on them writes.

## Open a step in a tab

**Open in a tab**, on the line of a step whose table the last run kept, draws that step's result full size in a tab of its own, beside the recipe's: the same view the step has, a Table, Summary, Board, Calendar or loose cards, with the whole height of the window to use. A step under no `show` opens in the Table view, since the tab has room for every row. The command **Open cell result in a tab** does the same for the step at or above the cursor. The tab is named after the recipe and the step's number, counted from the top (_weekly.recipe · cell 2_).

The tab follows the recipe: a new run draws it again with the new rows, and it closes when the recipe's tab closes. Its sort, filter and columns are its own, apart from the step's. It is not brought back when Tyto opens again: open it again from the step. A step from a recipe opened by `run` has no button; open that recipe to draw its steps in a tab.

## Fold a table

The arrow at the start of the line folds the step's table away and brings it back. Every table starts open. A folded table stays folded while the tab is open, through new runs and when it scrolls out of view; closing the tab or quitting Tyto opens them all again.

## Open a run step

A `run other` step shows one table, the one the recipe `other` ends with. **Show the included recipe's cells**, on its line, opens it onto the steps of `other`, each with its own line and its first rows, and a recipe `other` runs in turn one step further in. They are for reading: no button on them runs, applies or fetches, and opening them asks for nothing, since the last run already brought them. Each draws the preview of its table even under a `show`, and only a `run` that worked has them; one that failed says why on its own line. A step opened stays open while the tab is open, as a folded table stays folded.

## Run from here

**Run from here**, on the line of any step with a table or a plan, runs that step and every step below it, whatever changed. It is **Run recipe** from that step down: it fetches when a step below needs to, and it runs in a folder not trusted.

A source's own cache still answers, so **Run from here** on a source step does not fetch again by itself if the source keeps what it fetched. The command **Run recipe from this cell** does the same from the step your cursor is in, or the nearest one above it.

## Fetch again

**Fetch again** is on the line of a step that fetches: a source, or a `run` of a recipe that holds one. It runs the whole recipe again, and every source fetches instead of answering from its cache. The command **Run recipe, fetching again** does the same from anywhere in the tab.

Use it when the data changed where it lives and the table under the source is older than you want: the line's _data fetched …_ says how old it is.

## Apply a plan

A step that writes (an action or a sink) does not write while the recipe runs: it answers a **plan**, what it would write. It says how many writes and where (_Plan: 3 to write to example items_), on its line, or under its table when the step also passes its rows on; under that are the plan's first 20 operations, one per line, then how many it leaves out (_40 more operations_).

**Apply**, on the plan's line, writes that plan: exactly the operations you are reading, not a new plan made at the click. It is offered only when the plan can be applied now: its step ran this time, its plan was not applied yet, and its verb can apply. While the writes are on their way the button stays, dimmed, and a second click does nothing. A click is your approval, in a folder not trusted too.

Afterwards each operation carries its mark, _applied_, _failed_ or _skipped_, with the reason when there is one (a row that changed since the plan was made fails rather than being written over), and a line counts them: _2 applied · 1 failed_. A plan is applied once; to apply again, run the step again for a new plan.

When Apply is refused, the reason shows under the plan, in red, until the next run: the plan was replaced by a later run, or its step did not run this time. Run the recipe again and look at the new plan.

### apply auto

A recipe whose header has the line `apply auto` applies its plans without a click, but only on **Run recipe** (or **Run from here**, **Fetch again**) in a trusted folder. A pause in typing or a save never applies. In a folder not trusted the plans are made and shown, and the plan says _apply auto waits: this folder is not trusted, so Apply asks for a click_.

## Run on an interval

A header line `every 5m` (or `every 30m`, `every 2h`) runs the recipe on its own while Tyto is open, when the recipe is anywhere in the open workspace folder and that folder is trusted:

```
recipe watch
every 5m
```

- The shortest interval is 5 minutes; there is no longest. A recipe without the line runs only when you ask.
- It runs the file as saved, not what is typed in a tab and unsaved. Its first run is one interval after the folder is opened, and each run after that one interval after the last one started. A run still going when the next one is due makes it skip that one rather than queue it.
- Nothing runs while Tyto is closed: it installs no background service. After the computer sleeps, a recipe whose time passed runs once.
- In a trusted folder a run on its own counts as **Run recipe**, so a recipe with `apply auto` applies its plans. In a folder not trusted it runs nothing, and the panel says it is held.
- A recipe whose `param` has no default is listed but never run on its own: nobody is there to give the value.

When a run has a problem (a step that fails, or a plan whose writes fail), Tyto raises one notification of the operating system, with the recipe's name and the problem's code; click it to open the recipe. Later runs with problems stay quiet until a run is clean again. A clean run is silent, and so is a plan waiting for **Apply**.

### The Schedules panel

**Show or hide: Schedules**, in the command bar, opens the **Schedules** tab of the bottom panel. It has a row for every recipe of the open folder that runs on an interval: its name and interval, when it last ran, when it runs next, and how the last run ended: _ok_, _problem_ with the problem's code, _held: restricted folder_, _plan waiting for Apply_, _needs_ and the parameters it lacks, or _not run yet_.

**Run now** runs the recipe at once, without waiting for its time; it is dimmed while the recipe runs and for a recipe that needs a parameter. **Open** opens the recipe in a tab.

## Write a brief per row

`to-brief` is a step that turns each row of the table into a brief, in the template you name, in a folder of the workspace:

```
to-brief template=promo-curso into=../briefs name=slug slots=titulo:title,subtitulo:summary
```

- `template=` is the template, found the way a brief's `template:` line finds it.
- `into=` is the folder the briefs go in, read from the recipe's folder. It stays inside the workspace and never names `.tyto`.
- `name=` is the column that names each file: `lesson-1` becomes `lesson-1.brief`. Two rows that would write the same file stop the step and name both.
- `slots=` pairs each slot of the template with a column, as `slot:column` separated by commas. `slots=@./slots.json#/lesson` reads the pairs from a data file instead.

Like every step that writes, it writes nothing while the recipe runs: it answers a plan with one line per brief, `briefs/lesson-1.brief: new`, or `briefs/lesson-1.brief: overwrites` when the file is already there. **Apply** writes them. A brief somebody edited after the plan was made fails with _changed since the plan_ and is left as it is; the others are written.

A value is brief text, so `**bold**` in a cell is bold in the brief. A value that holds `{` or `}` stops the step and names the row and the column: briefs have no way to write a brace, so fix the data first, with `rewrite`. An empty value leaves the slot to the template's default.

`to-brief` writes only in a trusted folder: in a folder not trusted, or a recipe in no workspace, the step says so and plans nothing. Run `tyto render` on the briefs afterwards, as for briefs written by hand; a required slot left out is reported there.

## Send a request per row

`call` is a step that sends one HTTP `POST` per row to an address you name, with a credential stored on your machine:

```
call url=https://hooks.example.com/run token=routine body={"key": "{key|}", "title": "{title|}"}
```

- `url=` is an `https://` address. No other kind is sent to, and an address with a user, a password or a `#` is refused.
- `token=` names the credential, in lower-case letters, digits and `-`. The recipe holds only the name; Tyto sends the value as `Authorization: Bearer …` and never shows it in a plan or a message.
- `body=` is JSON to the end of the line, or `body=@./call.json#/routine` to read it from a data file. Each text in it is filled from the row, `{title|}` on a recipe line; numbers, `true`, `false` and `null` are sent as written. A body is at most 16 KiB.

**The address's host must be on the workspace's list**, in `.tyto/project.json`:

```json
{ "recipes": { "call": { "hosts": ["hooks.example.com"] } } }
```

Each host is named whole: no `https://`, port, path or `*`. Only a trusted folder's list counts; a folder not trusted, or a recipe in no workspace, plans no request. A list in the folder replaces the one in a work profile.

Like every step that writes, it sends nothing while the recipe runs: it answers a plan with one line per row, `POST <address> <body>`. **Apply** sends them one by one. An answer from 200 to 299 is _applied_; any other status fails that row with the status, _hooks.example.com answered HTTP 503_, and the others still go. A redirect is not followed, so it fails its row too, and a request with no answer after 30 seconds fails. What the address answers is never shown or kept.

To send each row once, remember what was sent: a row whose request failed is not remembered, so the next run plans it again.

```
last dispatched
where last_stored_at is empty
call url=https://hooks.example.com/run token=routine body=@./call.json#/routine
remember dispatched columns=title
```

**Where the credential comes from.** In the command line it is an environment variable, `TYTO_RECIPE_CREDENTIAL_` followed by the name in upper case with every character that is not a letter or a digit turned into `_`: `token=routine-hook` reads `TYTO_RECIPE_CREDENTIAL_ROUTINE_HOOK`. `tyto mcp`'s `run_recipe` checks the list and the credential and shows the plan, and never sends: an agent can preview a dispatch, not carry one out. A place to store a credential in the window, and sending from the window, are coming; until then the window shows the plan and says it sends none.

## Change the language

**Switch the window language** redraws every step's line and table in the new language at once, ages included.
