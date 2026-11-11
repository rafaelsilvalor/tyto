# 0175 — A recipe runs on an interval only while the app is open

Status: accepted · 2026-11-08 · TYTO-385 · builds on ADR 0086, ADR 0111, ADR 0127, ADR 0128,
ADR 0129, ADR 0163 and ADR 0170

## Context

ADR 0127 decision 5 asked for recipes that run on their own, as Buraqueira's watcher runs its
pipeline every five minutes while its window is open and speaks only when something is wrong.
Nothing in Tyto runs on its own: a recipe runs when a person presses Run, and `apply auto`
(ADR 0170 decision 6) applies without a click only on that explicit Run in a trusted folder.
ADR 0129 decision 4 already named the scheduled case and its two conditions, and the amendment
ADR 0170 wrote into it said "a scheduler, when it comes, follows the same two conditions".

The questions the card left open:

- How does a recipe say it wants a cadence, and how short may it be?
- Which recipes does the host run: the open tabs, or every recipe in the workspace?
- What happens when a run is still going at the next tick, or the machine slept through ten?
- What may a scheduled run write, and in which folders?
- How loud is it? A recipe every five minutes that notifies every run is noise nobody reads.

TYTO-385 lands in three pull requests: this record and the header in `@tyto/recipe`; then the
scheduler in the desktop's main process, the runner's flag, the notification port and the
channels; then the Schedules panel, its strings, the manual and an end-to-end test.

## Decision

1. **`every <n>m` or `every <n>h` is a header line**, reserved like `apply` and `param`, and
   parsed into `RecipeAst.every = { minutes }` (`every 2h` is `{ minutes: 120 }`). Anything
   else after `every`, a second one, or one after the first step is `E_RECIPE_SYNTAX`, at the
   line, the same way `apply auto` is refused. **The shortest interval is 5 minutes**
   (`MINIMUM_INTERVAL_MINUTES`), the watcher's own cadence: every scheduled run reads its
   sources again, and a shorter one mostly spends the source's rate limit. There is no ceiling.
   A recipe without the line runs only when asked, as before.
2. **The host schedules every recipe in the open workspace folder, read from disk.** Main
   discovers `*.recipe` files by walking the workspace folder, skipping what the explorer
   skips, and walks again when the explorer reports a `.recipe` change. It runs the text on
   disk, never an unsaved buffer: a schedule follows the file a colleague shares, not what is
   half-typed in a tab. A recipe whose `param` has no default is listed as needing that
   parameter and is not run, since nobody is there to supply it.
3. **One run at a time per recipe, and a busy tick is skipped.** Runs are keyed by the recipe
   file's real path. The next run is timed from the start of the last one (a chained timer, not
   a fixed grid); a tick that finds the previous run still going is skipped, not queued. After
   the machine resumes from sleep, a recipe whose time passed runs once, never once per missed
   tick. Every schedule stops when the window closes: nothing runs while the app is closed, and
   Tyto installs no background service.
4. **A scheduled run counts as explicit only in a trusted folder.** The runner receives a
   `scheduled` flag. In a trusted folder (ADR 0111) a scheduled run is treated as an explicit
   Run, so `apply auto` applies its plans without a click: ADR 0129 decision 4's two
   conditions, `apply auto` and a trusted workspace, now hold for a real scheduler. In a
   restricted folder, or with no workspace open, a scheduled run is held as restricted and runs
   nothing. A scheduled run keeps its cells under its own key (`schedule:<realpath>`), apart
   from a tab's, and its Apply queues on the recipe's path, so a scheduled Apply and a tab's
   Apply of the same file never commit state at the same time (ADR 0170 note, "applies are
   serialised per document").
5. **It notifies on the change from clean to a problem, and only then.** A problem is a failed
   cell, an error diagnostic, or a failed operation of an applied plan. The first scheduled run
   with a problem after a clean one raises one OS notification; later runs with problems stay
   quiet until a clean run resets it. A plan waiting for Apply is not a problem: the panel shows
   it, no notification does. The text is the recipe's name and the diagnostic code, never a
   row's values, which may be private; a click opens the recipe. Main reaches the operating
   system through an injected `notify` port, so the scheduler is tested without one.
6. **A Schedules tab in the bottom strip (ADR 0163) lists them**: recipe, last run, next run,
   last outcome, with Run now and Open. Run now asks main by a schedule id main assigned, never
   by a path (ADR 0086).

## Consequences

- A recipe's cadence travels with the file: whoever opens the folder in a trusted workspace
  runs it on the same interval, and a restricted folder never runs it at all.
- A run longer than its interval runs back to back rather than piling up; the skipped ticks are
  the price, and the panel's last and next run show it.
- A recipe that fails every run notifies once. Someone who missed the notification learns of
  the failure from the panel, not from a second notification.
- Two windows on one workspace would each schedule its recipes; that is out of this record and
  waits for a window that can tell another one is running them.
- Until the second pull request lands, `every` parses and nothing runs it.

## Note, 2026-11-08: the scheduler in main

The second pull request settles what the record left to the code:

- A recipe's first run is one interval after main finds it, not at once: opening a folder does
  not fire every recipe in it, and an `every 5m` recipe runs twice in its first ten minutes.
- A scheduled run starts from the first cell, so every source is called again. Whether it also
  skips the plugins' own caches is settled by the note of 2026-11-11 below.
- Main walks the folder again when a burst of changes names a `.recipe` file. A folder renamed
  or moved with recipes inside is reported by the watcher under the folder's name alone, so its
  recipes are found again only at the next `.recipe` change or when the folder is reopened.
- A notification's click focuses the window and pushes `schedule:changed` with the schedule's
  id in `open`; the window opens it through `schedule:open`, by that id, as `queue:open-brief`
  opens a task's brief.

## Note, 2026-11-11: a scheduled run reads live

TYTO-648 settles what the note of 2026-11-08 left open. A plugin's own cache (ADR 0138) can
outlive the shortest interval: a source that keeps answers for ten minutes would hand an
`every 5m` recipe rows up to ten minutes old, and a watcher would react late or not at all.

- Every scheduled run passes `fresh`, as Fetch again does: each source's `page` is handed
  `refresh: true` (ADR 0148) and skips its cache. No recipe header or argument asks for it; a
  schedule exists to see the source as it is now.
- `fresh` also forgets the kept cells of the run's own document, `schedule:<realpath>`, which
  a run from the first cell recomputes anyway. A tab's cells for the same file are never
  touched, and a person's Run keeps using the plugins' caches as before.
- The cost: one live request per source cell per tick, for every scheduled recipe in the open
  folder. A provider's quota is spent in proportion to the number of scheduled recipes and the
  shortness of their intervals; a cache no longer absorbs it.
