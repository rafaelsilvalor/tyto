# Data recipes and the Jira and Google connectors

Status: **exploration, not binding** · 2026-10-24 · hosted by TYTO-368 · see
`docs/explorations/README.md`

The settled parts are ADR 0127 (connectors are installed plugins; the core gains only generic
services), ADR 0128 (a recipe is a closed-vocabulary notebook), ADR 0129 (a write verb plans
first), ADR 0130 (a plugin's private cache and host-mediated workspace files) and ADR 0131
(browser sign-in is a host service). This note holds the reasoning, the parity map against
Buraqueira and the questions those ADRs leave open.

## Context

On 2026-10-24 the maintainer asked for the first two real plugins:

- **Jira**: pull issues by JQL, work on them locally, change their status and edit them.
- **Google**: read and write Drive files and Sheets.

Together they must do what Buraqueira's pipeline does today, plus manipulate the pulled data
locally and share that manipulation with other people. Sending to a spreadsheet is one output
among several, not the point.

Two sibling projects on his machine already hold the behaviour. Both were read for this note
(read, not run):

| Project    | Language       | What it does today                                                                                                                                                                                                                                                   |
| ---------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buraqueira | Python         | Production. Every 5 minutes while its window is open: Jira → the "Avulsas" Google Sheet, then back to Jira (the sheet decides the status). Writes transitions, assignee, a custom field and comments. Creates Drive folders and spreadsheets. **Recipes**: `flow.py` |
| Jacurutu   | TypeScript CLI | Reads Jira (JQL, paged), exports a fixed table to CSV, JSON or a one-way Sheet. Never writes to Jira. Has a Drive adapter with an OAuth loopback flow that no command uses yet                                                                                       |

**Where the manipulation the maintainer wants already exists is Buraqueira's `flow.py`, not
Jacurutu.** `flow.py` chains closed verbs over one table and freezes the chain as a recipe:

```
python flow.py pull MC-1079255 derive kind name where "issuetype = DESIGN" \
               select key,kind,deliverable show save campaign-map --param parent=MC-1079255
python flow.py run campaign-map parent=MC-1073953
```

The recipe on disk is `receitas/mapa-campanha.json` (`receita_version: 2`): name, description,
parameters and a list of `{verb, args}` steps.

## What Tyto's plugin API offers today

Measured in the code at `origin/main` c005b91.

| Need                                   | State                                                                                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Outbound HTTP                          | **Exists**: `host.fetch` behind `net:<host>` (`packages/plugin-api/src/host.ts:136`, ADR 0042) |
| Read a secret                          | **Exists**: `host.credentials(key)`, typed in by the person, keychain-backed (`host.ts:142`)   |
| Write a secret (a refresh token)       | Missing                                                                                        |
| Settings for an installed plugin       | Missing: refused because the schema is Zod (`isolation/points.ts:413`). **TYTO-254**           |
| A runnable command                     | Missing: `editor.command` is an id and a title. **TYTO-261**                                   |
| Panel ↔ its own plugin process         | Missing: a panel reaches `fetch` and `credentials` and nothing else (ADR 0045)                 |
| Writing any file, private or workspace | Missing: the plugin process may read only its own folder (ADR 0049)                            |
| Browser sign-in                        | Missing: a plugin cannot listen on a port, and `shell.openExternal` opens two fixed URLs       |
| Background or scheduled work           | Missing: E10.1 frozen; every call has a 30 s deadline (`PLUGIN_CALL_DEADLINE_MS`)              |
| Installing from the window             | Missing: the CLI installs, the window lists                                                    |
| A data table or notebook               | Missing: no cell, table or grid concept anywhere                                               |

So "prepare the plugins" is mostly "extend the plugin API". The connectors themselves are the
smaller part.

## The model

### Three layers, and who owns each

```
 the workspace (private repo)       recipes, field ids, status graphs, aliases, kept tables
 ─────────────────────────────────────────────────────────────────────────────────────────
 installed plugins                  tyto-plugin-jira      jira.* verbs
 (own repositories)                 tyto-plugin-google    sheets.* and drive.* verbs
                                    a private plugin      domain derivations (see below)
 ─────────────────────────────────────────────────────────────────────────────────────────
 Tyto                               the table model, the generic verbs, the notebook,
                                    plan → apply, cache, workspace files, sign-in, scheduling
```

**Tyto knows tables, verbs and OAuth 2.0 as a protocol. It knows no provider** (ADR 0127).
`where`, `select`, `join` and `show` are as generic as a CSV, so they belong in Tyto, in a pure
package. "Jira" and "Google" appear only in the two connector plugins, which live in their own
repositories. ADR 0011's consequence already foresaw that remote sources "return as
medium-sized plugins without touching the core".

**What is the company's own goes in the private workspace, not in a public repository.** The
Tyto repository is public since 2026-10-06. Buraqueira's config carries `customfield_10052`,
the MC, MCA and PMA status flows and the Avulsas sheet id. Those are data: they go in the
plugin's section of `.tyto/project.json` (ADR 0112) or a work profile (ADR 0114).

**Domain derivations are code, so they need a third plugin.** `derive kind` and `derive name`
classify an issue summary into kind, phase, format and deliverable, by the company's naming
rules (`core.DERIVACOES` in Buraqueira). ADR 0079 gave Tyto no user-script tier, so a
rule that is code cannot live there. It goes in a small **private** plugin that contributes
derivations through the same verb point the connectors use. This is the cost of keeping both
Tyto and the connectors public; the alternative, a closed derivation vocabulary in the
connector, would put one company's naming in a public repository.

### The table

One value type passes between verbs:

```ts
interface Table {
  columns: readonly Column[]; // name (English, the contract), type, origin
  rows: readonly Row[]; // key, values by column name, provenance
}
type ColumnType = 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'list' | 'link';
interface Provenance {
  source: string;
  id: string;
  fetchedAt: string;
} // 'jira', 'TYTO-12', ISO
```

- **Column names are English and are the contract; values are whatever the source holds**
  (Portuguese for this team), the rule `flow.py` learned (`kind = anuncio`, not `kind = ad`).
- **Every row keeps its provenance.** A write verb needs to know which issue or which sheet row
  a table row came from, after any number of `where` and `join` steps.
- Values are plain JSON. A table crosses the plugin boundary as JSON (memory: IPC from
  Electron to Node needs JSON), and it is what the cache stores.

### The recipe file

A **text file, one verb per line**, `*.recipe`, edited in Tyto's editor like a brief. JSON was
rejected because a one-step change should be a one-line diff, and because the verb chain is
what the person reads. The header carries what `receita_version 2` carried as fields:

```
recipe campaign-map
  | One row per DESIGN issue of a campaign, copy and media paired.
param parent = MC-1079255

jira.pull parent={parent}
derive kind name
join copy  left="issuetype = DESIGN" right="issuetype = COPYWRITER"
join perf  left="issuetype = DESIGN" right="issuetype = PERFORMANCE"
where issuetype = DESIGN
select key, status, kind, phase, deliverable, folder_name, copy_key, perf_key
show table
```

- **Every line is a cell.** Cell N reads cell N−1's table and hands its own to N+1, which is
  exactly `flow.py`'s chain. v1 is linear with one table. Named tables (`pull … as copy`) are an
  open question below.
- **Generic verbs have bare names; contributed verbs are namespaced** by their plugin
  (`jira.pull`, `sheets.write`). A recipe that names a verb no installed plugin contributes is a
  diagnostic at that line, with a range, like an unknown directive in a brief.
- **`param` makes a recipe reusable**, by name and by value, as `--param` does today.
  `run <recipe> parent=…` includes another recipe at its position.
- Aliases stay input-only and never reach a saved recipe or an output header, the four fences
  `flow.py` documents.
- **Results never live in the recipe file.** A Jupyter notebook stores its outputs inside the
  `.ipynb`, which is why its diffs are unreadable. A cell's table goes in the cache, keyed by
  the recipe, the cell and its inputs. `keep <name>` writes a table into the workspace on
  purpose (ADR 0130).

### Why a notebook of verbs and not Jupyter

The maintainer asked for "Jupyter style": dynamic, easy to write and easy to share. The
notebook keeps the first two and changes the third, for four reasons:

1. **Sharing a Jupyter notebook is running somebody's program with your Jira token.** A recipe
   can only do what its verbs allow, and every write shows its plan before it applies
   (ADR 0129). Receiving a recipe from a colleague is safe in a way that receiving code is not.
2. **No Python runtime on designers' machines.** The recipes run inside Tyto.
3. **Readable diffs** (above).
4. **Proven.** The vocabulary is at its second version in Buraqueira, with rules learned in use:
   aliases are input-only; a `join` never pairs an ambiguous key and reports
   "ambiguous (N candidates)" instead; a cut-off JQL result aborts instead of looking complete.

The door stays open: a sandboxed expression verb or code cell can be added by a later ADR if
the closed vocabulary runs out. Opening later is cheaper than closing later.

### The notebook view

A recipe opens as a document whose cells are its lines. Under each cell is the table it
produced, or its diagnostics. Run one cell (and what it depends on), or all. The **Table view
is v1**. Later views are separate cards: board by status, grouped summary, delivery calendar,
and **loose cards**, where each card shows the fields the person picked and opens to show all
of them. `show <view>` picks the view, and like `flow.py`'s `show` it never decides rows or
columns.

### Verbs, and the four kinds a plugin can contribute

| Kind      | Reads → writes               | Examples                                                                    |
| --------- | ---------------------------- | --------------------------------------------------------------------------- |
| source    | nothing → table              | `jira.pull`, `sheets.rows`, `drive.list`                                    |
| transform | table → table, pure          | `derive kind` (private plugin), the generic verbs                           |
| action    | table → **plan**, then apply | `jira.transition`, `jira.set`, `jira.assign`, `jira.comment`, `jira.create` |
| sink      | table → **plan**, then apply | `sheets.write`, `sheets.sync`, `sheets.create`, `drive.folder`, `to-brief`  |

The generic verbs, in Tyto: `param`, `run`, `where`, `select`, `join`, `sort`, `derive` (with a
registry that plugins extend), `show`, `keep`. `group` and `count` arrive with the summary view.

**A source pages.** Every call into a plugin has a 30 s deadline, and a JQL search over a
quarter's issues does not fit in one. A source returns one page and a cursor, and the host
loops. A result cut short by the source's limit is an error, never a quiet partial table,
which is the rule Buraqueira's `fetch.py` enforces with `isLast`.

**`to-brief` is Tyto's own sink.** Each row becomes a `.brief` in a chosen template, its
columns mapped to slots, written to a folder the person picks, with plan → apply like any
write. This is where the notebook meets what Tyto already does: a campaign's issues become
the briefs of its artwork.

### Plan, then apply

**No write verb writes when its cell runs** (ADR 0129). It returns a plan: the target, one
line per operation ("TYTO-12: FAZENDO → FEITO", "Demandas!A14: new row"), and a count. The
notebook shows the plan under the cell, with **Apply**. Applying runs the plan as it was shown,
not a recomputed one, and records what happened in the cell's result. Two inheritances from
Buraqueira:

- **An allow-list per connector.** `adapter_jira_escrita.py` names the only writes it may make.
  The Jira plugin declares its write kinds and nothing else exists.
- **Transitions walk a status graph one checked step at a time** (`levar_ate`), from a graph in
  the workspace config, because Jira has no "go to status X" call.

A scheduled recipe (below) may apply without a click only when its header says so
(`apply auto`) **and** the workspace is trusted (ADR 0111). A restricted folder never writes
on its own.

### Where data lives

- **Raw answers, private to the plugin**: a cache the host keeps per plugin, outside the
  workspace, keyed and dated, always shown with its age (Buraqueira's `.cache/`, with
  `--refetch` as "Run again without the cache").
- **Recipes and kept tables, in the workspace**: versioned, in the explorer, shareable.
- **Secrets, in the keychain**: Jira's API token, the Google service account key and the
  OAuth refresh token, never in the workspace.

### Identity: two for Google, as Buraqueira has

Buraqueira signs in to Google twice. A **service account** syncs the sheets, and the
maintainer's **own sign-in** creates folders and spreadsheets, because a service account owns
no storage in somebody's Drive. Chosen on 2026-10-24: a token and a service account first, then
the browser sign-in inside this epic (ADR 0131), since the full replacement of Buraqueira
creates folders and spreadsheets.

### Scheduling

Buraqueira's watcher runs the pipeline every 5 minutes **while its window is open** (its
ADR 0004), and reports only problems. Tyto does the same: a recipe may declare
`every 5m`, and the host runs it while the app is open. There is no system service and no
run on a closed laptop. This thaws E10.1 in that one form.

## Parity with Buraqueira, step by step

The replacement is complete when every step of `run_local.py:323-478` has a recipe line, and
the Avulsas recipe's plan matches Buraqueira's `sync_report.json` on the same day's data.

| Buraqueira step                           | In the notebook                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1. Routine returns (Drive inbox)          | `drive.list` on the inbox folder → `sheets.write` of description and link → `jira.set` folder field      |
| 2. `fetch.py`, JQL from a pipeline file   | `jira.pull jql=…` with the pipeline's lenses as params; copy-document resolution is a private derivation |
| 3. Rows the query no longer returns       | `jira.pull keys=…` from `sheets.rows`, unioned (needs named tables, see questions)                       |
| 4. `sync.py` diff to the sheet            | `sheets.sync key=TaskFilha` → plan of add, update, move to month tab, delete                             |
| 5. `notify.py` report                     | the plan and its applied result are the report; problems become notifications                            |
| 6. Targeted refresh                       | `where copy is empty` → `jira.pull keys=…`                                                               |
| 7. Archive month tabs older than 3 months | `sheets.archive` (off by default, as today)                                                              |
| 8. Routine dispatch                       | **open**: posts to a claude.ai routine, an outside service with its own token                            |
| "The sheet decides the status", 72 h hold | `sheets.rows` → private derivation of the status plan → `jira.transition`                                |

## What is reused

| From       | What                                                                           | Into                     |
| ---------- | ------------------------------------------------------------------------------ | ------------------------ |
| Buraqueira | `flow.py` verbs, the recipe format, alias fences, join's ambiguity rule        | Tyto's recipe package    |
| Buraqueira | `adapter_jira_escrita.py` allow-list and `levar_ate` transition walk           | `tyto-plugin-jira`       |
| Buraqueira | `lib_sheets.py`: batchUpdate, dropdowns, native tables, 429 backoff 10/20/40 s | `tyto-plugin-google`     |
| Buraqueira | `core.DERIVACOES`, `lib_status.py` rules                                       | the private plugin       |
| Jacurutu   | `packages/adapter-jira/src/http.ts`: cursor paging, field catalog              | `tyto-plugin-jira`       |
| Jacurutu   | `packages/core/src/export.ts`: issue → flat row                                | `jira.pull`'s projection |
| Jacurutu   | `packages/adapter-drive/src/auth.ts`: loopback OAuth                           | ADR 0131's host service  |

## The cards, in the order they unblock each other

| Epic                    | Cards                                                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E11 — plugin services   | TYTO-370 secret write · TYTO-254 settings · TYTO-371 cache and workspace files · TYTO-261 runnable commands · TYTO-372 panel ↔ process · TYTO-373 install from the window · TYTO-374 browser sign-in                                              |
| E17 — recipe notebook   | TYTO-375 pure recipe package · TYTO-376 verb contribution point · TYTO-377 notebook editor · TYTO-378 plan → apply · TYTO-379 Table view · TYTO-380 `to-brief` · later: TYTO-381 board, TYTO-382 summary, TYTO-383 calendar, TYTO-384 loose cards |
| E10 — remote connectors | TYTO-385 scheduled recipes · TYTO-386 Jira pull · TYTO-387 Jira writes · TYTO-388 Sheets · TYTO-389 Drive · TYTO-390 create as the signed-in person · TYTO-391 private rules plugin · TYTO-392 Buraqueira parity and switch-over                  |

## Open questions

- **Named tables.** Step 3 of the parity map unions two pulls, and `flow.py`'s join is only a
  self-join. Named tables make the chain a graph. Decide when the parity card reaches it.
- **Distributing the Google OAuth client id to the team.** Jacurutu left this open: an
  installed-app client id is not a secret, but every designer needs the same one. ADR 0131
  puts it in the plugin's manifest; whether the company's Google admin must approve it is not
  measured.
- **The plugin network is advisory on Node 24.** A plugin that imports `node:net` gets out
  (`docs/plugin-api.md`). These plugins hold real tokens, which makes that gap matter more.
- **The routine dispatch (step 8)** talks to a claude.ai routine. Whether it moves into a
  plugin or stays outside is not decided.
- **Saci**, the TypeScript project Buraqueira's `PORTING.md` names as the destination of its
  mechanisms, may overlap with this work. Not measured.
- **Jacurutu's Jira side becomes redundant** once `tyto-plugin-jira` exists. Its future is not
  decided here.
