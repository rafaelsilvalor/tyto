# 0148 — The recipe notebook runs in main and reruns from the first changed line

Status: accepted · 2026-10-27 · TYTO-377 · builds on ADR 0086, ADR 0111, ADR 0119, ADR 0128,
ADR 0129, ADR 0137, ADR 0138, ADR 0139, ADR 0140 and ADR 0147

## Context

ADR 0128 made a recipe a notebook: every line a cell, cell N reading cell N−1's table, each
table shown under its line. `@tyto/recipe` runs a chain (`runRecipe`), `@tyto/plugin-api` turns
the installed plugins' contributions into its registries, and `@tyto/io` has the adapters for
data files (ADR 0137) and state (ADR 0140). Nothing ran a recipe in the window. TYTO-377 lands
the notebook in five pull requests: the editor's language (A), the runner in main (B, this
record), the `.recipe` tab (C), the notebook view and the manual (D), and `refresh` for sources (E).

Three things have to be settled before a renderer can show anything:

- **Where it runs, and what it composes.** A run calls plugins, reads files beside the recipe
  and reads the machine's state; the renderer may do none of those (ADR 0010).
- **What a pause in typing runs.** A source is a network fetch, and a recipe may begin with
  one. ADR 0119 already said that typing never reaches a plugin's fetch for a brief.
- **What a folder nobody trusted may run.** A recipe is content a folder ships (ADR 0111).

## Decision

1. **A recipe runs in main**, behind `recipe:run` and `recipe:verbs` (`shared/ipc.ts`). The file
   is the one main holds for the tab (`documents.pathOf`), never a path the window sends
   (ADR 0086). `recipe-runner.ts` composes, in `apps/desktop` only: the window's plugins'
   verbs through `recipeRegistriesOf`, each verb handed its own plugin's section of the folder
   **asked per call** (`WorkspaceService.sectionFor`, ADR 0147); `workspaceDataResolver` with
   the folder and its trust (ADR 0137); `recipeStateStore` bound to the workspace and the
   recipe, **read-only** (ADR 0140); the clock in the person's zone (ADR 0139); and `run x`
   reading `x.recipe` in the recipe's own folder, after `realpath`, and nowhere else (ADR 0112).
2. **Cells are kept in memory, per document.** Each kept cell has its step's signature (its
   verb and the text after it, as written) and its answer. A run starts at the first step whose
   signature changed or whose last answer was not a table, and hands that run the table the
   cell before it kept as `input`. **A change to the header, a `param` line, the file's path,
   or the folder's trust reruns every cell.** A run started after another for the same document
   wins: the older one, finishing later, keeps nothing. The cells are forgotten when the tab
   closes (`file:close`) and on `fresh`. Nothing is written to the recipe or to disk (ADR 0128
   decision 6); `from` reruns from a cell down whatever changed.
   _Amended 2026-10-28 (TYTO-377, pull request C):_ a `run x` step's signature also holds the
   text of `x.recipe` and of every recipe it includes in turn (a cycle not followed, at most
   `INCLUDED_DEPTH_MAX` = 8 deep), read once per run through the same reader the run uses, so
   editing an included recipe on disk reruns the cell that includes it on the next run.
   _Amended 2026-10-28 (TYTO-377, pull request D):_ **Run from here** under a cell, and the
   command `recipe.runFromCell` from the cell at or above the cursor, send `from` with
   `explicit`: it is Run, so it fetches and runs in a folder not trusted. The window shows 20 of
   the 50 rows the wire carries under each cell, then how many it leaves out. Which tables the
   person folded is the renderer's alone, per open tab: never sent to main, never written, and
   forgotten when the tab closes or the app restarts.
3. **A pause in typing runs from the changed line down, and stops before the first source.**
   A source fetches only on save (`saved`) or Run (`explicit`), as a brief's images do (ADR
   0119). The source's cell and the ones after it are `stale`: they show the table they had and
   run next time. `held: 'source'` says why.
4. **A restricted folder runs nothing by itself.** Run is the approval, as a person typing
   `tyto render --section` is (ADR 0147 decision 5); even then its data files are refused
   (`E_RECIPE_DATA_RESTRICTED`) and its sections are withheld, by the workspace and again by the
   runner. `held: 'restricted'` says why. A save is not Run: it settles the text, not the trust.
5. **Outside any workspace**, or in a tab never saved, there are no data files and no state,
   and cells run as in a trusted folder: nothing a folder ships is involved, as a brief there
   fetches (ADR 0119 decision 4).
6. **Nothing is written before Apply.** State is read-only in a run: `write` answers
   `E_RECIPE_STATE`. `remember`'s writes and an action's plan ride the result; applying them is
   TYTO-378's (ADR 0129, ADR 0140 decision 4).
7. **The time zone is the `recipeTimeZone` setting**, an IANA name declared by the built-in
   desktop plugin; `null`, the default, is the machine's. Its offset is read per instant with
   `Intl.DateTimeFormat`, so a zone with daylight saving answers each date its own. The key has
   no dot because a built-in's key would be read as a plugin's prefix (ADR 0073). A name the
   runtime does not know is `W_SETTING_INVALID` and the default applies.
8. **A cell's age is the host's `ranAt` and its oldest row's `fetchedAt`.** A plugin cache's
   `storedAt` (ADR 0138) stays inside the plugin and never reaches a verb's result, so the
   notebook shows when the host ran the cell and how old the oldest data in it is.
   _Amended 2026-10-28 (TYTO-377, pull request D):_ the age is relative ("ran 2 min. ago · data
   fetched 3 hr. ago"), computed in the renderer with `Intl.RelativeTimeFormat` in the window's
   language, and rewritten in place every 30 s so a cell's element and key stay. A change of
   language shows every open recipe's last answer again, built anew in the new language.
9. **The wire is bounded** (`RECIPE_WIRE_LIMITS`): the first 50 rows of each table and its
   total, a value cut at 1,000 characters, a list joined as a person writes it. Main keeps whole
   tables; the window is shown a preview.
10. **`refresh` has a seam and no meaning yet.** The runner hands its registries factory a
    `refresh` flag (from `fresh`); TYTO-377's last pull request gives sources a way to skip their
    cache with it, in `@tyto/plugin-api`.
    _Amended 2026-10-28 (TYTO-377, pull request E):_ the flag has its meaning. Run again without
    cache builds the registries with `refresh: true`, and every `page` call of that run, on every
    page, carries `refresh: true` to the source, which skips its private cache (ADR 0138) and
    fetches; an ordinary run carries no key. The field crosses to an isolated plugin over
    isolation protocol 9, so a plugin process on 8 is refused at `hello`. `transform` and `plan`
    carry nothing new, since they read no cache.
    _Amended 2026-10-28 (TYTO-377, pull request D):_ the person reaches it as **Fetch again**
    (`fresh` with `explicit`), for the whole document only: a button on a cell that fetches,
    and the command `recipe.runFresh`. Which cells fetch crosses the wire as each cell's
    `source`, which main decides with the policy's own test (a source verb, or a `run` whose
    recipe holds one), since the window knows verbs by name and not by kind.

## Consequences

- A recipe edited below its source reruns in milliseconds from the kept table, and the source
  is asked again only when the person saves or presses Run.
- A colleague's recipe opened from a restricted folder shows its lines and nothing runs until
  Run; the run then has no data files and no sections, so a rules verb fails visibly.
- ~~Open: a `run x` whose recipe holds a source fetches while typing.~~ **Closed 2026-10-28
  (TYTO-377, pull request C):** the policy reads the included recipe before a pause runs it. A
  `run` step counts as a source when its recipe holds one at any depth, through the run's own
  reader, with the recipes already on the chain not followed (a cycle ends) and the same depth
  bound as the signature; an included recipe that cannot be read is not a source, and the run
  fails it as before. Measured in `recipe-runner.test.ts`: `run x` and `run y` → `run x` hold
  with 0 fetches while typing, and fetch on save and on Run.
- Open: cells kept for a large table cost main's memory until the tab closes; no ceiling is
  measured yet.
- The renderer drops a stale answer by `requestId`, as `brief:preview` does; main's part is
  echoing it and not letting an older run replace the newer one's cells.
