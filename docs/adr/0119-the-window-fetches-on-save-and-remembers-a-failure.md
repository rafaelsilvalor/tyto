# 0119 — The window fetches from a plugin on save and on open, and remembers a failure

Status: accepted · 2026-10-22 · TYTO-280 · under ADR 0117 and ADR 0118 · applies ADR 0111 and
ADR 0042 to the window

## Context

ADR 0117 put a plugin's images and faces behind a cache in `TYTO_HOME`, and ADR 0118 said when
the CLI may fetch into it. The window has two problems the CLI has not.

- **The preview compiles while a person types.** A brief that is on its way from `test:` to
  `test:logo` passes through `test:l`, `test:lo` and `test:log`, and each pause in typing is a
  compile. A compile that fetched would ask a plugin — maybe a network — for every one of them.
- **The main process lives for hours.** The CLI's cache lives for one run, so a reference that
  failed is asked once per run. The window's preview compiles on every pause and every save: a
  cache that forgot a failure would ask the plugin again each time, and a plugin that hangs
  costs its 30 s deadline (ADR 0042) on every one.

And one the photographs of the real window found: the banner that trusts a folder shows only
when the folder **left something out**. A restricted folder whose project file names nothing
outside it has no banner at all, so a miss that pointed at it pointed at nothing.

## Decision

1. **A compile fetches when a person did something that settles the text**: saving the brief,
   opening it from disk, or exporting it from the export box. A preview while typing reads the
   cache and asks nothing; its miss says "save it to fetch". The renderer marks the compile it
   sends after `file:save` and after opening a file with `fetch: true` on `brief:preview` — a
   field, not a channel. **A restored hot-exit draft whose text differs from its file does not
   fetch on restore**: it is a draft, not a file (ADR 0080), and it fetches on its first save. A
   restored tab whose text is its file's fetches, as an open does.
2. **A fetch in flight is not cancelled.** It is bounded by ADR 0117's size ceilings and the
   plugin's deadline, and lands in the cache atomically. Previews answer out of order by design
   (`shared/ipc.ts`): text typed while it runs is compiled at once against the cache, and the
   fetching answer is dropped as stale if newer text exists — the next compile reads what it
   wrote.
3. **One source cache for the process**, shared by the preview and the export, so the image a
   save fetched is the one the export embeds. **A failed fetch is remembered for the process**,
   image or face: it is asked again after a restart, or for a different reference. The miss
   keeps the plugin's reason and adds "Tyto asks again after a restart, or for a different
   reference". The price is stated plainly: **a brief network blip stays failed until the app
   restarts.** A miss that was never a fetch — typing, a restricted folder, the queue — is not
   remembered: it is a rule, not a failure, and the save after it still asks. `sourceCache`
   gained `remembersFailures` and a per-call `SourceCall` for this; the CLI sets neither.
4. **Who may fetch, as ADR 0118 says for the CLI**, with the trust of the brief's folder:
   - inside the folder the window has open, that folder's trust (a trust taken back still holds
     until it reopens, ADR 0111);
   - **outside it, the workspace the CLI would find by walking up, and its answer in the trust
     store**, so one file fetches the same in both programs; no workspace at all fetches, as a
     loose `tyto render` does;
   - a brief in no file yet fetches nothing — it has no folder, and no save to settle it;
   - **the queue never fetches**, as `tyto watch` does not; its miss says to open and save the
     brief once.
5. **A restricted folder's miss names the command, not the banner**: "trust it with Workspace:
   Manage Trust to fetch", or for a brief outside the open folder, "open that folder and trust
   it with Workspace: Manage Trust". The command exists whenever a folder is open; the banner
   only when something was left out.

## Consequences

- Typing never reaches a plugin; a save or an open does, at most once per reference per
  process.
- A face that arrives mid-session reaches the preview in the same compile: the library is
  refreshed, a new face cache measures with it, and the preview compiles once more (ADR 0117's
  rule, applied by hand because the preview does not run the job).
- The queue renders from what a save or an export box run already cached.
- The miss is a diagnostic, in English like every diagnostic, while the window's labels follow
  the chosen language; the command it names is the English one.
- Open: retrying one failed reference without a restart, and a source that comes back online.
