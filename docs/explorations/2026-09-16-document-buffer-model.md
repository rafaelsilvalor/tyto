# Document and buffer model, on CodeMirror 6

Status: **exploration, not binding** · 2026-09-16 · hosted by TYTO-105 · see `docs/explorations/README.md`

Related, and where the settled parts would land: ADR 0006 (CodeMirror), ADR 0010 (hexagonal,
pure packages), ADR 0013 (warnings on the ok branch), ADR 0024 (Lit renderer, layout as a
record), `docs/architecture.md` (desktop processes).

## Context

Tyto's editor has to hold several briefs at once, compare them side by side, and keep a live
preview against whichever one is in front. TYTO-102 shipped the first half of that: a
workspace of documents, one editable view, and a tab per document.

The model below is the second half. It is Vim's separation of **buffer** and **window**,
implemented on CodeMirror 6. It was reached in a design session and is recorded here as
reached — the rationale and the rejected alternative for each decision, unsoftened. What it
is not is a mandate: the audit at the end measures how far today's code is from it, and two
of the decisions collide with things this repository has already settled elsewhere. Those
collisions are named rather than resolved.

## The core model

```ts
interface Doc {
  id: string;                 // stable, independent of path
  path: string | null;
  state: EditorState;         // the document of record
  savedDoc: Text;             // what is on disk
  mirrors: EditorView[];      // read-only views on this Doc
  subscribers: /* … */;
}

interface Pane {
  id: string;
  docId: string;
  role: 'edit' | 'mirror' | 'preview';
  scrollTop: number;
}
```

**A Pane references a Doc and never owns it.** Closing a pane stores `view.state` back into
the Doc and destroys the view. Closing a Doc is a separate action and prompts when dirty. A
Doc with no pane is an `EditorState` sitting in the store — Vim's hidden buffer, exactly.

## Decisions

### D1 — `EditorState` is the document of record

The store owns it. An `EditorView` is only a viewport onto it.

**Rejected:** `EditorView` as the owner of content. It forces a re-read on every switch and
loses state that lives in the view rather than in the store.

### D2 — At most one editable view per Doc

Additional panes on the same Doc are **read-only mirrors**: their own `EditorState`,
`readOnly`, and deliberately **without `history()`**. A mirror receives only `tr.changes`,
forwarded with a sync `Annotation` so the echo is recognisable and dropped.

**Rejected:** two editable views sharing a document. The history field diverges between them
and undo desynchronises.

**Revisit only if a real need appears.** The fix at that point is to lift undo out of
CodeMirror and into the store, which is a much larger change and should not be paid for
speculatively.

> This answers the question TYTO-105 named as the hard one. The card says a cursor belongs
> to a window while `DocumentSnapshot` puts it in the buffer, and offers "two windows on two
> buffers only" as the cheap way out. D2 is a third answer and a better one: two windows on
> _one_ buffer, with the second one not editable.

### D3 — Dirty is derived, never stored

`!doc.state.doc.eq(doc.savedDoc)`.

**Rejected:** a boolean flag. Undoing back to the saved content clears the indicator under
the derived form and cannot under the flag — which is precisely the behaviour E9.8 shipped
and TYTO-102's end-to-end suite pins today.

### D4 — Derived-pipeline cache keyed by object identity

`Text` is immutable, so identity is a valid cache key:

```ts
WeakMap<Text, BriefAST>;
WeakMap<BriefAST, SceneIR>;
```

Invalidation is automatic, and undo/redo hits the cache rather than recomputing, because the
old `Text` object comes back.

**Raster output is not cached this way.** It uses an explicit LRU capped in bytes, keyed by
`(docId, format, IR hash)` — a `WeakMap` cannot bound memory, and rasters are the only
artefact large enough for that to matter.

### D5 — The compiler parses with the Lezer parser over the full text

It must **not** use `syntaxTree(state)`. That tree is viewport-limited and truncates
silently on a long brief, producing partial IR intermittently — which is the worst failure
shape available, because it is correct most of the time.

The editor's tree serves highlighting and inline diagnostics only.

### D6 — Pipeline cadence

- AST on `docChanged`, ~50 ms debounce.
- Scene IR at ~200–300 ms, or on idle.
- Raster **never per keystroke** — on demand, or on long idle and only while its pane is
  visible.

The SVG preview carries the real-time feedback, so the rasterizer stays off the hot path.

### D7 — Selection travels with the Doc, scroll with the Pane

Selection lives in `EditorState`, which the Doc owns. Scroll position is per Pane
(`view.scrollDOM.scrollTop`), because two panes on one Doc scroll independently.

## Search

### D8 — In-document search: `@codemirror/search`

`search`, `searchKeymap`, `highlightSelectionMatches`, `gotoLine`. Nothing to build.

### D9 — Cross-document search over open Docs

`SearchCursor` and `RegExpCursor` operate on a `Text`, not on a view and not on a state, so
**every Doc in the store is searchable including those with no pane open**. This is Vim's
`:bufdo /pattern`.

### D10 — Disk search for unopened files

Main process, `fs.promises` plus a directory walk with an ignore list.

**Do not bundle ripgrep.** The corpus is a briefs folder, not a large code repository. Wrap
the walk behind an interface so the implementation can be swapped later.

### D11 — The dirty-content hazard

Build the set of open paths **before** walking the directory, and exclude them from the
walk. An open Doc is always searched through its in-memory `Text`, never from disk. One
search, two sources, no overlap.

### D12 — Hits are live positions

On each transaction, remap that Doc's hits with `tr.changes.mapPos`, dropping hits that fall
inside deleted ranges. Hits from unopened files are stored as `{ path, line, offset }` and
converted to live positions only when the file is loaded into the store.

### D13 — Multi-file replace goes through the store

Applied as transactions on Docs loaded into the store, never as direct disk writes. That
gives per-document undo and a visible dirty state before anything is saved.

### D14 — Search sits behind a matcher interface

One hit type, two implementations: `TextMatcher` now, and `StructuralMatcher` over the
cached AST later — for queries like "which briefs use template X" or "which declare a layer
named `selo`".

## Explicit non-goals

- **Do not generalise every panel into a document.** Vim's `buftype` makes an error list a
  buffer because a terminal has one primitive. This is Electron: error lists, template
  pickers and layer inspectors are ordinary components.
- **Do not model tab pages as file tabs.** A Vim tab page is an arrangement of windows, and
  conflating it with "one tab per open file" is the thing this model exists to separate.

## Open questions

- What trigger conditions would justify two editable views on one Doc.
- An indexing strategy that lets structural search reach unopened files.
- Visual diff between rendered outputs, not just between source texts.

---

# Audit — how the code diverges, as measured on 2026-09-16

Measured against `main` at `aa043cf`, after TYTO-102. Line numbers are a snapshot and will
rot; the file and the symptom outlive them.

## Symptom 1 — `EditorView` is treated as the owner of content

**Confirmed, and it is the deepest divergence of the three.**

| Where                                             | What it does now                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `packages/editor/src/editor.ts:241`               | `getValue: () => view.state.doc.toString()` — the handle's only read path is the view                                           |
| `apps/desktop/src/renderer/documents.ts:45`       | `snapshot` is documented as refreshed when the document _stops_ being active, and "stale for exactly as long as it _is_ active" |
| `apps/desktop/src/renderer/main.ts:456`           | Save reads `editor.getValue()`                                                                                                  |
| `apps/desktop/src/renderer/main.ts:1168`, `:1172` | The preview request reads `handle.getValue()`                                                                                   |
| `apps/desktop/src/renderer/main.ts:1071`          | The template picker reads `editor.getValue()`                                                                                   |
| `apps/desktop/src/renderer/main.ts:359`           | The picker's current value reads `editor?.getValue()`                                                                           |

For the **active** document the store holds no content at all. `captureActive()` writes the
state back only when something is about to take the document away — which is correct for one
pane and is exactly what D1 forbids.

**What the model requires:** the store holds the live `EditorState`, updated from an update
listener on every transaction; every call site above reads the store.

**Rough size:** medium. One listener, one field made non-optional, six call sites, and the
`DocumentSnapshot` shape loses its reason to exist in its current form. The end-to-end suite
should not need to change, which is the signal that the refactor is behaviour-preserving.

**D3 rides on this.** `dirty` today is a stored boolean, set on the first change in
`main.ts`'s `onChange` and cleared only by a save; undoing back to the saved text leaves the
tab marked. `e2e/tabs.desktop.test.ts` pins that behaviour deliberately ("marks each tab that
was typed in"). Under D3 that test's expectation inverts, which makes it the right place to
measure the change.

## Symptom 2 — the preview consumes document text, not scene IR

**Confirmed structurally, and it is not an accident.**

| Where                                       | What it does now                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/desktop/shared/ipc.ts:147`            | `brief:preview` carries `brief: z.string()` — the whole document text, on every debounce tick                    |
| `apps/desktop/src/main/ipc.ts:66`           | The handler compiles in **main**                                                                                 |
| `apps/desktop/src/main/preview.ts:176–203`  | parse → resolve → load template → compile → export, in full, per request, with no cache between calls            |
| `apps/desktop/src/renderer/documents.ts:48` | A document holds `frames` — self-contained HTML strings. There is no AST and no `Scene` anywhere in the renderer |

**What the model requires:** `WeakMap<Text, BriefAST>` and `WeakMap<BriefAST, SceneIR>` in
the store, with the preview consuming IR.

**The collision, stated rather than resolved.** D4 puts the AST and the IR in the renderer.
`docs/architecture.md` puts the compile in main, for a reason that is not inertia: the
preview resolves `assets/logo.png` against the open file's folder and embeds the bytes, and
only main has a disk. ADR 0010 does allow the compiler to run in the renderer — `core`,
`brief-lang`, `template-lang` and `export-*` import no Node and no DOM precisely so they can
— but moving it there splits asset resolution across the bridge, and the renderer's
Content-Security-Policy refuses a `file://` read.

**Rough size:** large, and the first deliverable is an ADR, not a refactor. A cheaper
intermediate exists and should be measured first: keep the compile in main and give it D4's
two `WeakMap`s there, which buys the undo/redo cache hit without moving anything across the
bridge.

## Symptom 3 — `view.setState()` on switching files

**Confirmed, one occurrence.**

`packages/editor/src/editor.ts:248`, inside `restore()`:

```ts
view.setState(snapshot.state);
```

**What it does now:** swaps the whole state into the single view when a tab is activated.
The comment beside it explains the choice against a change transaction — a transaction would
put the tab switch itself on the undo stack.

**The tension, honestly.** With exactly one pane this _is_ D1's "the view is a viewport":
the store hands the view another document's state. The line only becomes a divergence when a
second pane exists, because then a single view swapping states is no longer a viewport onto
a Doc but a viewport onto whichever Doc it last held. It is the line that has to change when
D2's mirrors land, and it is fine until then.

**Rough size:** small in isolation; it is a consequence of Symptom 1 rather than an
independent fix.

## Decisions that are already satisfied, or that need restating

**D5 is already true.** `grep syntaxTree` across `packages/` and `apps/` finds it only in
`packages/editor/src/completion.ts`, `template-completion.ts` and `template-lint.ts` — all
editor-side, all for highlighting and inline diagnostics. The compiler calls
`parser.parse(text)` directly at `packages/brief-lang/src/parse-brief.ts:295`. The trap D5
names is real and nothing has fallen into it.

**D6's premise needs restating for the desktop.** Today there is one flat 200 ms debounce
for the whole pipeline (`PREVIEW_DELAY` in `main.ts`), not three cadences — so the tiering is
a real change. But "the rasterizer stays off the hot path" is already true and more strongly
than D6 assumes: the desktop preview never rasters at all. It sends **HTML** per frame and
the renderer shows it in a `sandbox=""` iframe, because the renderer is already Chromium and
encoding a PNG for Chromium to decode is a round trip whose only products are latency and a
lossy copy (`docs/architecture.md`). D6's "SVG preview carries the real-time feedback" does
not describe this app; the HTML preview already does that job.

**D8 is "nothing to build" only after a dependency is added.** `@codemirror/search` is not in
`packages/editor/package.json` and is imported nowhere.

**D10 has a house rule to respect.** `CLAUDE.md` requires every adapter to implement a port
from `core` or `plugin-api`, and `@tyto/io` already declares a `FileSystem` port that
`nodeFileSystem()` implements. A directory walk on raw `fs.promises` would be the first
adapter in the repo without a port. D10's own "wrap it behind an interface" is the same
instinct; the interface already exists and should be reused rather than invented.

## What this audit did not look at

Only the three symptoms asked for, plus the decisions that happened to be checkable with a
grep. Not examined: whether `mirrors` and `subscribers` have any analogue today (they do
not), the search decisions D9–D14 against any existing code (there is none — search does not
exist in the app), and the cost of D4's LRU.
