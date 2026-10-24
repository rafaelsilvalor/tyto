# 0132 — A text tab is a file of a format main names

Status: accepted · 2026-10-24 · TYTO-247 (first of two pull requests) · amends ADR 0124 (the
subject union gains a member in the second pull request) and ADR 0121 (what a new file opens) ·
under ADR 0010 and ADR 0080

## Context

Until TYTO-247 the window opened only briefs. The file dialogs filtered on `.brief`, a click on a
`.md` in the explorer did nothing (ADR 0115, ADR 0124), and `explorer:create` opened a tab only
for a new `.brief`. Rafael chose on 2026-10-08 that Tyto opens and edits `.txt` and `.md` files,
with a preview for Markdown, and never makes artwork from them.

In the renderer a document's `kind` was `'settings' | 'keybindings' | 'snippets'`, and `undefined`
meant a brief. About twenty call sites read "not a brief" and meant "an app file": validate it on
typing, validate it on restore, open it in JSON, reopen it by its command and not its path. A text
tab is the first kind that is neither a brief nor an app file, so each of those sites had to say
which of the two questions it was asking.

Rafael's decisions of 2026-10-24: only `.txt` and `.md` are text (`.json`, `.csv` and `.yaml`
stay out); a rename of an open tab keeps its kind until it is reopened; the wording below. The
coordinator split the card in two: this pull request is the tab that knows its kind, plain editing,
opening and saving; the second adds Markdown colours with `@lezer/markdown` and a sanitised
preview, and adds a dated note here.

## Decision

1. **Main names the format from the path's extension, in one place.** `describe` in
   `src/main/documents.ts` — the door every open, reopen, save and session restore passes —
   answers `format: 'brief' | 'text' | 'markdown'` beside the text (`documentFormatOf` in
   `shared/file-icons.ts`): `.txt` is `text`, `.md` is `markdown`, case-insensitive, and anything
   else `brief`, which is what every file the window opened was before. The window never guesses a
   format from a name it holds.
2. **The window takes the format when a file comes into a tab and keeps it for the tab's life.**
   `DocumentState.kind` gains `'text' | 'markdown'`. A rename through the explorer (ADR 0121)
   changes the tab's name and tooltip and not its kind: `notas.brief` renamed to `notas.md` is a
   brief until it is closed and opened again, and a quit and a relaunch is such a reopen. An app
   file's kind is still the one its command opened, whatever main names it.
3. **Three predicates replace "kind is undefined"** (`src/renderer/documents.ts`): `isBrief`
   (compiled, previewed, linted, exported), `isAppFile` (checked by its validator, opened by its
   command) and `hasPath` (a file main holds by path and the session reopens by it: a brief or a
   text file). Each former site keeps its meaning for briefs and app files. A text file is neither
   compiled nor validated: no `brief:preview` on open, on typing, on save or on restore.
4. **A text tab's chrome is its own case** (`TEXT` in `editor-chrome.ts`): `briefCommands: false`
   and `templateEdits: false`, so export, export presets, zoom, format and slide drop out through
   the gate TYTO-283 built (`commandOffered`). It opens in `plain`, Markdown included until the
   second pull request, in the editor's font area and not the JSON one. Problems says "Text files
   are not checked." / "Arquivos de texto não são verificados."; the status bar's kind says "Plain
   text" / "Texto simples" for `.txt` and "Markdown" for `.md`. No "Open preview to the side", no
   breadcrumb, no strip and no grid.
5. **Opening.** A click or Enter in the explorer opens a `.txt` or a `.md` in a tab, as a brief:
   `explorer:open` asks `filePath(entryId, ['.brief', '.txt', '.md'])`, ADR 0124's generalisation,
   and `briefPath` goes. `explorer:create` opens a new `.txt` or `.md` in a tab as it does a
   `.brief`. File ▸ Open filters, in this order: "Brief"; "Text files" / "Arquivos de texto"
   (`txt`, `md`); "All supported files" / "Todos os arquivos suportados" — built by main in the
   window's language (`openFilters`). Save As offers the tab's own format first (`saveFilters`):
   `file:save` carries an optional `format`, absent for a brief and for an app file.
6. **The session keeps a text tab like a brief.** `sessionTabKind` and `session.json`'s tab kind
   gain `text` and `markdown` at the end, so a file written before still reads, with the version
   still 1. A text tab is kept by the path main holds and its draft, reopened by that path, and
   restored as the kind its file has then; a draft whose file is gone comes back as an untitled
   tab of the same kind.

## Rejected

- **The window naming the format from the tab's name.** It holds the name, so it could; but the
  name is a label main may replace (`<id> · brief.brief` for a queue task), and main already
  answers every open. One source of truth for what a file is, beside the path only main knows.
- **Re-deriving the kind after a rename.** A brief renamed to `.md` mid-edit would lose its
  preview and its lint between two keystrokes, and its undo history stays in a buffer built for
  the other language. Rafael chose the reopen as the moment a kind changes.
- **Treating `.json`, `.csv` and `.yaml` as text.** Out by Rafael's decision; `.json` in
  particular is the app files' format and would blur the line this ADR draws.

## Consequences

- A text tab saves, marks unsaved work and comes back after a quit as a brief does (ADR 0026,
  ADR 0080); nothing new was needed there.
- A session written by this build names kinds an older build's `session.json` reader refuses, and
  an older build reading it opens an empty window. The data folder is per version (ADR 0032), so
  only a hand-copied file meets that.
- File ▸ Open is still labelled "Open a brief…", though it now opens text files too.
- New strings, in both locales: `problems.empty.text`, `status.kind.text`,
  `status.kind.markdown` ("Markdown" in both), `dialog.files.text`, `dialog.files.supported`.
- Measured in `e2e/text-tabs.desktop.test.ts`: opening, editing and saving a `.md` asks main for
  0 `brief:preview`, and main naming `.md` a brief turns that suite red.
