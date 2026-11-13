# Recipes

::: info How this page was checked
Every behaviour below was checked on 2026-10-28 on a development build of Tyto on Windows 11, by the desktop test suite that opens a `.recipe` over an installed source plugin and counts the source's fetches: none on open, one on **Run recipe**, none on **Run from here**, one on **Fetch again**, none on an edit below the source. **Apply** was checked on 2026-11-07 by the same suite, applying the example recipe plugin's plan and reading each operation's mark. The Table view was checked on 2026-11-07 by a suite that scrolls a 5,000-row table to its last row, sorts it and filters it; copying was checked by unit tests, not in the window. Opening a step in a tab was checked on 2026-11-08 by the same suite, drawing the 5,000 rows full size and closing the recipe. Opening a `run` step was checked on 2026-11-08 by the same suite as Apply, reading the included recipe's tables and plan. Writing briefs with `to-brief` was checked on 2026-11-08 by a test of the desktop's main process that plans three rows into a folder, applies the plan and renders each brief with `tyto render`, not in the window. A run on an interval fetching past a source's cache was checked on 2026-11-11 by a test of the desktop's main process with a source that keeps its answers for ten minutes, not in the window. Sending with `call` was checked on 2026-11-11 by tests of the shared recipe runner against a stand-in endpoint, not over the network and not in the window. `tyto recipe run` was checked on 2026-11-11 by the command line's tests, through the shared runner with a stand-in plugin that plans 120 operations and a stand-in endpoint, not by hand. Making a recipe and a vocabulary, and the vocabulary tab's marks, were checked on 2026-11-11 by the desktop test suite that starts from an empty trusted folder, and its completion and hover by unit tests. Adding and editing steps by form was checked on 2026-11-11 by the desktop test suite that builds a recipe from an empty trusted folder with a source plugin, `where`, `select` and `rules`, runs it and compares the saved file with the lines the forms showed, and by the same suite reopening the last step with **Edit step**; a refused value and the completion of a vocabulary reference by unit tests. Planning a step again after Apply was checked on 2026-11-12 by the shared recipe runner's tests, with `to-brief` over a real folder and a stand-in plugin, not in the window. Blocks, their toolbar and **Run this block** were checked on 2026-11-12 by the desktop test suite that opens a recipe over a source plugin, runs one block, folds a result, moves a step up, deletes a note and compares the saved file; moving and deleting every block of a recipe by unit tests. The **+** between blocks, notes, the counter and **Run from here down** were checked on 2026-11-12 by the same suite, which inserts a step between two blocks with **+**, runs only that block, reads the counters, moves the block up and compares the saved file. Menus and labels below are the English window's.
:::

A recipe (`.recipe`) is a list of steps, one per line, that fetch rows from a source, filter and reshape them, and plan what to write. Tyto opens a recipe in a tab as a notebook: **under each step, its result**, a table you can read while you write the next line.

## Open one

Open a `.recipe` from **File > Open…** (choose **Recipe** in the dialog's file type list), or click it in the Explorer. The status bar names the kind: **Recipe**. Steps are coloured, and a verb is offered as you type at the start of a line: the generic ones and every verb your installed plugins add.

Problems in a recipe go where a brief's go: underlined in the text and listed in the **Problems** panel.

## Start one

Right-click in the Explorer and choose **New Recipe…**, or run **New recipe** from the command bar, and type a name. Tyto adds `.recipe` and writes a recipe that runs as it is: its header, one line describing it and one `param` with a default. Your first edit is a step.

A recipe's name is how a `run` line names it, so it starts with a letter or a digit and holds only letters, digits, `-` and `_`. Any other name is refused under the field with the code `E_RECIPE_FORM`, and nothing is written. A file already there is never replaced.

## Load a shared recipe

A colleague's recipe can sit anywhere on disk. Right-click a folder in the Explorer and choose **Load Recipe…**, or run **Load recipe…** from the command bar, and pick the `.recipe` file. Tyto **copies** it into that folder (the selected folder, the selected file's folder, or the open folder with nothing selected), together with what it needs to run there:

- the recipes its `run` lines include, `<name>.recipe` beside it;
- the data and vocabulary files its steps name, such as `@./company.vocab.json#/rules/kinds`, in the same folders relative to it.

The copy is yours: it runs in this workspace, with its files beside it and its state here. The original is never changed.

**Nothing is overwritten.** If any of those files is already in the folder, nothing is copied at all, and the Explorer lists each one that is there, so a recipe is never half loaded. Rename or move them, and load again.

Some references are not followed, and the Explorer says which and why, above the tree:

- a file outside the recipe's folder, such as `@../shared.json`, or a link that leads out of it, is never read;
- a reference that is not one, a file that is not there, one in the folder's `.tyto` settings, or one larger than a recipe may read is left out;
- an included recipe that does not read as a recipe is copied, but the files it names are not looked for.

Click the lines to put them away.

## Add and edit steps

Run **Add step** from the command bar with a recipe in front. A list of every verb opens, grouped into **Sources**, **Transforms**, **Actions** and **Sinks**: the generic ones and every verb your installed plugins add. Type to narrow it, move with the arrow keys and press Enter, or click a verb.

The verb's form follows, one field per argument. A required field says so; a field left blank shows the value the verb assumes; a field with a fixed set of values is a list. A field that names a column, a list of columns or a `where` expression offers the columns of the step before it, from its last run: click one to put it in. Under the fields, the form shows the line it will write. **Write step** puts that one line at the end of the block the cursor is in, so the block grows by one step and shows that step's result. With the cursor on a blank line or in the header, the line starts a new block below, set apart by a blank line; above every block, it goes at the end. See [Work in blocks](#work-in-blocks).

To change a step, put the cursor on its line and run **Edit step**: the form opens filled from the line, and **Write step** writes the line back in its place.

The text stays the recipe: the form is a way of typing one line, and you can still edit the line by hand. A value one line cannot carry, such as a double quote in a value with a space, is refused next to its field with the code `E_RECIPE_FORM`, and nothing is written. Put such a value in a vocabulary file and refer to it.

## Write its vocabulary

The rules, rewrites and lookups a recipe reads live in a vocabulary file beside it, `<name>.vocab.json`. Choose **New Vocabulary…** in the Explorer, or run **New vocabulary**, and type a name: Tyto adds `.vocab.json` and writes one rule to start from. A recipe reads one of its tables by name, as in `@./company.vocab.json#/rules/kinds`.

A `.vocab.json` opens in a tab of its own, and the status bar names it **Vocabulary**. No other `.json` opens in a tab. The tab is checked as you type, the way the `rules`, `rewrite` and `map` steps will read it: each rule's `when`, each pattern and template, and the shape of each section. A problem is underlined at its exact characters, escapes counted as the file writes them, and listed in **Problems**.

At the top level the tab offers the three sections, `rules`, `rewrites` and `lookups`; inside a rule or a rewrite step it offers the fields the entry is missing. Point at a section to read what it holds, or at a table's name to see how many entries it has and how a recipe reads it.

In the recipe, typing `@./` offers the vocabulary files beside it, and after the file's `#` the tables it holds, such as `/rules/kinds`. Only files in the recipe's own folder, or below it, are read for this.

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

Under each block's last step is one line, then its table. A block of several steps shows only its last step's result (see [Work in blocks](#work-in-blocks)):

- **The line** says what the step answered: _12 rows · 4 columns_, a plan (_Plan: 3 to write to Pauta_), _Failed: see Problems_, or why it did not run.
- **Its age**: when the step ran and how old its data is, such as _ran 2 min. ago · data fetched 3 hr. ago_. The data's age is when the source fetched it, which can be long before the step ran. The ages count up while the tab is open.
- **The table** shows the step's first 20 rows, then how many it leaves out (_30 more rows_). A wide table scrolls sideways inside the step. A long value is cut with an ellipsis; point at it to read it whole, and point at a column's name to see its type.

The table is a preview: the step still works on every row. To see all of them, see [Show a table whole](#show-a-table-whole).

## Show a table whole

A `show table` line draws every step from it down in the **Table view** instead of the preview: all of the table's rows, however many, in a box of twelve rows that scrolls. Only the rows in sight are drawn, so a table of thousands scrolls as quickly as one of ten. `show summary` draws the same view with a **Grand total** line under it, summing each number column.

- **Sort**: click a column's name to sort by it, again to reverse it, a third time to go back to the recipe's order. The sort is the view's: the next step still reads the rows in the order the recipe made them.
- **Filter**: type in _Filter rows_ to keep the rows that hold the text in any column shown, without minding case or accents. _Rows: 111 of 5,000_ says how many it kept. A Summary's totals add up the rows the filter keeps. The filter stays while the tab is open, through a new run (it counts the new rows) and a change of language, in every view that has one; the Calendar keeps its week or month too, and loose cards the card you had open. Quitting Tyto clears them.
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

**Open in a tab**, on the line of a step whose table the last run kept, draws that step's result full size in a tab of its own, beside the recipe's: the same view the step has, a Table, Summary, Board, Calendar or loose cards, with the whole height of the window to use. A step under no `show` opens in the Table view, since the tab has room for every row. The command **Open cell result in a tab** does the same for the step at or above the cursor, a step in the middle of a block included, whose result the block does not draw. The tab is named after the recipe and the step's number, counted from the top (_weekly.recipe · cell 2_).

The tab follows the recipe: a new run draws it again with the new rows, and it closes when the recipe's tab closes. Its sort, filter and columns are its own, apart from the step's. It keeps to its step: a step added or deleted above it does not hand it another one, and its number in the tab's name follows. When the step's own line is deleted, the tab says it has no result. It is not brought back when Tyto opens again: open it again from the step. A step from a recipe opened by `run` has no button; open that recipe to draw its steps in a tab.

## Work in blocks

A recipe reads as blocks, the way a notebook reads as cells. **A blank line separates one block from the next**: a block is the lines between two blank lines, and it can hold several steps and `#` comment lines. A block of comment lines only is a **note** block. The header (the `recipe` line, its `|` description and the `apply`, `every` and `param` lines at the top) is a block of its own, even with no blank line under it. A blank line belongs to no block. The block your cursor is in has a coloured bar at its left.

**A block shows only its last step's result**, under that step's line. Every step of the block still runs, and a step's problem is still marked on its own line and listed in Problems; when a step in the middle fails, the block's line says _Skipped: a cell above failed_. To see the result of a step in the middle, put a blank line under it, which splits the block in two, or put the cursor on it and run **Open cell result in a tab**.

On the first line of every block but the header, at the right, a small toolbar:

- **▶ Run this block**, on a block with steps: runs every step of the block, and the steps above it that changed since the last run, and stops there. The steps below it keep their last tables and say _Below the block run: runs on the next run_. It is **Run recipe** for that much of the recipe: it fetches, and it runs in a folder not trusted.
- **↑ Move up** and **↓ Move down**: swap the whole block with the one next to it. The blank lines between them stay where they were. A block never moves above the header.
- **✕ Delete block**: removes all its lines and the blank line that set it apart. It asks nothing; **Ctrl+Z** brings the block back, as it undoes a move.
- **▶▶ Run from here down**, on a block with steps: runs from its first step down to the end, as **Run from here** does.
- **▾ Hide result** (**▸ Show result** when folded), on a block with a result: the same as the arrow on its result's line.

The header's toolbar has **Run all**, which is **Run recipe**.

A small **+** sits on the boundary above every block but the header, and one below the last block, just left of the toolbars. Press it and choose:

- **Step…**: the step picker and form of **Add step** (see [Add and edit steps](#add-and-edit-steps)), offered the columns of the step above, and the line it writes goes there as a new block, with a blank line either side.
- **Note**: a `# ` line there, as a new block, with the cursor after it. Write the note; it is a comment, so it never runs. A note is drawn in the window's own font.

At the left of each block with steps, its **counter** says when its last step last ran: `[3]` is the third run that ran a step in this tab, counted whether a pause in typing or a button started it. `[*]` is a block a run is reaching now, and `[ ]` one whose last step has not run since the tab opened. A counter drawn dimmer, in italics, is **out of date**: a step of the block, or one above it, changed since it ran, or the last run stopped above it; hover it to read why. The counters are the tab's own: they start again when the tab closes.

The blocks are only a way of reading the text: moving or deleting one edits the recipe's lines, and saving writes them in the order you see. The file stays the text you can edit by hand.

## Fold a result

The arrow at the start of the line folds the step's result away and brings it back: its table or its view, a plan's lines, and a `run` step's included steps. The step's own line, with its buttons, stays. Every result starts open. A folded result stays folded while the tab is open, through new runs and when it scrolls out of view; closing the tab or quitting Tyto opens them all again.

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

Afterwards each operation carries its mark, _applied_, _failed_ or _skipped_, with the reason when there is one (a row that changed since the plan was made fails rather than being written over), and a line counts them: _2 applied · 1 failed_. A plan is applied once. The next run plans that step again, so its plan shows what the Apply changed: a brief it wrote now reads _overwrites_. An Apply that wrote nothing, refused or with every operation failed, leaves the plan as it was.

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
- Every run on its own fetches again, as **Fetch again** does: each source asks for fresh data instead of answering from its cache, so the recipe sees what changed by its next run. Each run spends one request per source, so many recipes on short intervals spend a service's quota faster. **Run recipe** in a tab still answers from the cache.
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

**Where the credential comes from.** In the command line it is an environment variable, `TYTO_RECIPE_CREDENTIAL_` followed by the name in upper case with every character that is not a letter or a digit turned into `_`: `token=routine-hook` reads `TYTO_RECIPE_CREDENTIAL_ROUTINE_HOOK`. `tyto mcp`'s `run_recipe` checks the list and the credential and shows the plan, and never sends: an agent can preview a dispatch, not carry one out. [`tyto recipe run --apply`](#run-from-the-terminal) sends them, in a trusted folder. **In the window**, open **Show plugins** and find **Recipe credentials** under the list of plugins: type the name `token=` uses and its value, and **Save** — or type the name and click **Import from file…** to store a file's text as the value. The value goes to the system keychain, and Tyto never shows it again: the section lists the names only, each with **Forget**, and saving the same name again replaces it. A credential is this computer's, for every folder on it; which hosts a recipe may send to is each folder's `recipes.call.hosts`, read only once you trust the folder. Until a credential is stored, the `call` line fails with a problem that says where to store it; once stored, the plan lists the requests and **Apply** sends them.

## Run from the terminal

`tyto recipe run <recipe>` runs a recipe in the workspace folder that holds it, with that folder's trust, through the same runner as the window. [Get the command](../command-line/index.md#get-the-command) says how to build it.

```
tyto recipe run recipes/sync.recipe
```

It prints one line per step, with its status and how many rows its table has, and under a step that writes, every operation of its plan, one per line: none is left out. It writes nothing and remembers nothing, as a save does; a recipe with `apply auto` only shows its plans.

- `--json` prints the whole answer as one JSON document: every row of every table with where it came from, every operation with its description and the plugin's data for applying it, and every problem with the line it points at. Send it to a file to keep a day's plan: `tyto recipe run recipes/sync.recipe --json > plan.json`.
- `--param <name>=<value>` gives one of the recipe's `param` lines a value for this run; repeat it for each. A name the recipe does not declare is an error.
- `--section <plugin>.<key>=<value>` sets a key of a plugin's section for this run, as in [`tyto render`](../command-line/render.md#other-options). A recipe's steps are handed sections only in a trusted folder, typed or not.
- `--apply` applies every plan once, as a click on **Apply** does, and remembers what the recipe remembers. It runs only in a trusted folder: anywhere else it is refused before any step runs. A recipe with `apply auto` applies once too. It is how the command line sends a `call` step's requests.

In a folder not trusted, `tyto recipe run` without `--apply` runs every step, as **Run recipe** does there: the folder's data files stay refused.

It exits 0 when everything ran, 1 when a step or an operation failed, a problem is an error or the command line was wrong, and 2 for an internal failure. It does not run on an interval: that stays the open window's.

## Change the language

**Switch the window language** redraws every step's line and table in the new language at once, ages included.
