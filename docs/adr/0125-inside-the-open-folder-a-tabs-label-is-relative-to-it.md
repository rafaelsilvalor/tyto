# 0125 — Inside the open folder, a tab's label is relative to it

Status: accepted · 2026-10-23 · TYTO-274 · amends ADR 0086 decision 3 · under ADR 0010

## Context

ADR 0086 (TYTO-288, absorbing TYTO-274) gave every tab a tooltip: the file's whole path with the
home directory written `~`, as VS Code writes it. Since then the window gained a workspace folder
(ADR 0113) and an explorer that opens briefs from it (ADR 0115), and a brief opened from
`D:\trabalho\promo\briefs\capa.brief` said its whole path on hover, the part the person had just
picked as their folder included. VS Code, with a folder open, writes a file inside it relative to
the folder.

Rafael rescoped TYTO-274 on 2026-10-23 to what TYTO-288 left: the label inside the open folder
(option 1 of three, the one that keeps the path form), the image preview tab TYTO-366 added, and
the breadcrumb line. The quieter name stays ADR 0085's: a sheet measured three candidates, and
dimming the extension failed 4.5:1 in 4 of 6 pairs.

## Decision

1. **Inside the open workspace folder, the label is relative to it and starts with the folder's
   own name**: `promo\briefs\capa.brief`, in the platform's separator, as the path has it. A file
   outside the folder keeps ADR 0086's label, `~\…` or the whole path.
   `pathLabelOf(file, home, root?)` in `src/main/path-label.ts` decides; on Windows it ignores
   case and takes `/` and `\` as one separator, keeping the path's own spelling. A sibling whose name starts with the
   folder's (`promo2` beside `promo`) is not inside it. A drive or `/` as the folder has no name
   to start a label with, and home's rule applies.
2. **The folder is the explorer's**, `ExplorerService.folder()`, the one it lists, injected into
   the document service as `root` by the composition root and asked at every open, save, rename
   and relabel, as `home` already is.
3. **When the folder changes, every open tab is labelled again.** `workspace:set-folder` (open,
   close, another folder) answers `relabelled` beside the workspace state: the document service's
   `relabel()`, which is `retargetUnder`'s answer for every tab that holds a file with nothing
   moved, and the window applies it with the same `withMovedDocuments` a rename uses (TYTO-352).
   At launch the session reopens the folder before the tabs (ADR 0080), so a restored tab is
   labelled for it already. A few lines, so done here rather than deferred.
4. **The image preview tab has the same tooltip.** The `explorer:image` answer gains an optional
   `pathLabel`, which the IPC handler writes from the entry's path through the document service's
   `labelOf`, so one function labels every tab. An `unchanged` answer carries none and the tab
   keeps the one it had.
5. **The breadcrumb line's `title` is the label of the file in front**, on the header row. No
   segment is added: the row still names only the block (ADR 0098). A preview in front hides
   the row, and a tab in no file gives it no `title`.
6. **Display only, as before.** No channel accepts a label, `file:reopen` still asks
   `recent.knows()` first, and a bare folder name is no path any channel would resolve (ADR 0010,
   ADR 0086 decision 2).

## Consequences

- The same file has two labels over a session: relative while its folder is open, `~\…` after.
  A label is still worked out at every open and never stored (ADR 0086 decision 4).
- A trust change re-reads the same folder and relabels nothing, because the folder did not
  change.
- `e2e/tab-folder.desktop.test.ts` asserts the explorer's brief, the image tab, the header row
  and the relabel on close; the native tooltip is drawn by the operating system, so the suite
  reads the attribute rather than a screenshot.
