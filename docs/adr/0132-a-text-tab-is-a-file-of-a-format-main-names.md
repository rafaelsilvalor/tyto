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

**Note, 2026-10-24 (TYTO-247, second pull request): the Markdown preview.** A `.md` tab opens in
the `markdown` language: `@lezer/markdown` with its GFM extensions (tables, strikethrough, task
lists, bare links), wrapped in a `Language` of a few lines in `packages/editor` as
`json-language.ts` is, and not `@codemirror/lang-markdown`, which brings `lang-html`, `lang-css`
and `lang-javascript`; MIT, depending only on `@lezer/common` and `@lezer/highlight`, already
here. The theme styles heading, link, URL, monospace, quote and strikethrough from the host's
tokens, so both themes. The preview is ADR 0124's subject `{ kind: 'markdown', documentId }`: the
tab keeps `documentId` as a brief's does, so the lock and the session treat it alike, and the
document's kind tells the two apart. It is drawn in the window, with no request and no new IPC,
by `markdownToHtml` in `@tyto/editor`, which walks the same parser's tree and is **sanitised by
construction**: it writes only a list of tags, every character of the source escaped; raw HTML
(`HTMLBlock`, `HTMLTag`, comments, processing instructions) comes out as text; a link is an `<a>`
with no `href`, its destination in `title`; an image is its alt text only (Rafael; showing images
is another card); no `style` or `on…` attribute. The page goes into the same `sandbox=""` frame
through `showDocument` under the unchanged CSP, fills the stage at 1:1, scrolls inside, and takes
the pointer, which a brief's picture does not. It follows typing on the brief's pause (200 ms).
It opens only on demand, through "Open preview to the side" (Rafael): decision 4's "no Open
preview to the side" now holds for a `.txt` only, and a following preview follows "a document
with a preview" (`hasPreview`), a brief or a `.md`. A Markdown preview focused is a tab kind of
its own, `markdown-preview`: no brief command and no text command, but Open preview and Lock. No
strip, no grid, no zoom, no export. Rafael's additions: File ▸ "Open a brief…" / "Abrir um
brief…" is now "Open…" / "Abrir…", and the status bar draws no Export button with a `.txt`, a
`.md` or a Markdown preview in front. Measured in `e2e/markdown-preview.desktop.test.ts` against a
local server counting hits: a Markdown image, a raw `<img>` and a clicked link reach it 0 of 3
times from the preview, 3 of 3 from what a renderer that kept them would write in a window with no
sandbox and no CSP, and 0 more from the preview's own document in that same open window.

**Note, 2026-10-28 (TYTO-377, pull request C): `.recipe` is a third text format.** A recipe opens
in a tab of its own kind, `recipe`, as `.txt` and `.md` do: main names it from the extension
(`documentFormatOf` answers `recipe` for `.recipe`, case-insensitive), `TAB_EXTENSIONS` gains
`.recipe`, so a click in the explorer and `explorer:create` open it in a tab, and the session keeps
it by its path with `recipe` appended to the tab kinds (still version 1). It opens in the `recipe`
language with the verbs `recipe:verbs` names offered at the start of a line, and is neither
compiled nor validated: the recipe notebook runs it in main (ADR 0148) on the pause a brief
compiles on, on save (`saved`) and by the one command Run recipe / "Executar receita"
(`explicit`), which is offered only with a recipe in front. Its diagnostics, the file's and each
cell's, go to the editor's lint and to Problems, whose empty state says "Nothing to report about
this recipe" / "Nada a relatar sobre esta receita", since a run is a check. Under each step one
muted line says what the cell did (Rafael): its table's rows and columns, a plan's count, "Failed:
see Problems", or why it did not run. File ▸ Open adds "Recipe" / "Receita" after "Text files",
and "All supported files" includes `recipe`; Save As offers `.recipe` for a recipe tab. The status
bar names it "Recipe" / "Receita" and draws no Export button. The explorer and the tab draw it
with the generic file icon.
