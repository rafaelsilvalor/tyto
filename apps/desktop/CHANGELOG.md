# @tyto/desktop

## 0.2.0

### Minor Changes

- bf4b0b9: TYTO-103 — the command bar, over the registry the editor already shipped

  `@tyto/editor` has had a command registry since E8.3, with a comment saying the order of
  `list()` is the order a palette should show. Nothing in `apps/desktop/src` had ever named
  `createCommandRegistry`. This wires it and puts a bar in front of it.

  **`Mod-K` opens a list of everything the window can do**, filtered as you type, with the
  keystroke beside the commands a keymap binds. Enter runs, Escape closes, the arrows move and
  wrap, and focus goes back where it came from. Matching folds accents and case and looks at
  the id as well as the label, so `previa` finds "Prévia: aumentar" and `preview.zoomIn` finds
  it while the window is in the other language.

  **Eleven commands**: undo and redo, which the registry brings itself; the five preview
  commands, the two slide commands, and — reachable for the first time — the locale switch and
  the vim toggle, neither of which any keymap binds. That is what a palette is for: the locale
  switch was a `<select>` in the footer and nothing else could reach it.

  **The zoom buttons now run commands rather than doing the work.** A button, a key and a bar
  entry are three ways to say one id, and a handler that did the work in the click listener
  would be a fourth definition of "zoom in" for the others to drift away from.

  Two details worth naming. The opener is a window listener and not a CodeMirror binding, so
  the bar opens with the preview focused, the panel focused or nothing focused at all — an
  unhandled keystroke in the editor bubbles out to it anyway. And **no desktop command
  declares an `undo`**, though the registry would take one: `Mod-z` is a single stack shared
  with the text, and a zoom on it would sit between two keystrokes somebody is trying to take
  back.

  The editor now receives the registry, which makes `Mod-z` the registry's undo rather than
  CodeMirror's — an app-level command on top of the stack comes off before the text under it.
  Thirteen catalogue keys arrive with the bar, and `window.desktop.test.ts`'s pin of "keys that
  are not an element's text" grows by all thirteen: a component translates inside its own
  render, so its strings never reach the `[data-i18n]` pass that test counts (ADR 0024).

- 2933a71: TYTO-42 — a problems panel, a template picker and an artwork list that move the editor

  Three panels, and what they share is that each one connects something the window already
  knew to somewhere in the brief.

  - **A problems panel under both panes**, listing every diagnostic with its severity, its
    code, its message and the line and column it points at. Clicking one selects that exact
    range in the editor, scrolls it into view and focuses it — the range travels as the offset
    pair the parser produced, so nothing converts it on the way. A diagnostic about the
    project rather than about a span of the brief is listed and is not a button, because there
    is nowhere for it to take you.
  - **A template picker** over the editor, reading the registry's manifests — name,
    description, formats, and a `preview.png` when a template ships one. Choosing a template
    rewrites the frontmatter's `template:` line as an ordinary editor edit, which is what makes
    the preview, the panel and Ctrl+Z all work with no second code path. A brief with no
    frontmatter gains one.
  - **The artwork list is driven by the brief's artworks, not by the frames on screen.** A
    slide that renders to one format only used to vanish from the list when the other tab was
    picked. Selecting a slide now also scrolls the editor to the `::directive` that created it.

  `brief:preview` gains an `artworks` list carrying each artwork's source range, which is the
  one thing a frame cannot carry: a `Scene` has no source position, so the number is picked up
  in `resolve` and passed forward. `templates:list` is a new channel. A folder that meant to be
  a template and could not be read as one now reaches the panel as the registry's own
  diagnostics — nothing said so before, because the preview service replays the registry's
  warnings and those failures are not among them.

  The panel sizes to its contents up to 30vh and scrolls past that. It was a flat 168px until
  the window was opened and measured: a clean brief reserved all of it to say "nothing to
  report", and the preview fitted a 1080×1080 frame at 32% instead of 44%.

- 5309eb2: TYTO-107 — a stage may produce a value and still report errors

  The preview keeps drawing while one directive is half-typed: an unclosed `**` costs that
  directive and nothing else, so the artwork stays on screen and the problems panel names what
  is wrong (ADR 0025). TYTO-108 marked the last good preview as stale; this renders the
  current one, minus the broken part.

  `tyto render` agrees with it. A brief with an unknown slot writes its artifacts, exits 1, and
  its `result.json` is `status: error` with those files listed — _rendered, with errors_, which
  `docs/render-contract.md` now describes.

  A brief with no usable template still renders nothing, and so does one whose frontmatter will
  not parse or that leaves a required slot unset. The gap has to be visible in the artwork
  before a missing required slot can be skipped, and nothing draws it yet.

- 9c82657: TYTO-109 — the search panel speaks the window's language

  Twenty-three catalogue keys arrive with find and replace: seventeen for the panel itself and
  six command labels. `src/renderer/search-phrases.ts` maps each of CodeMirror's own keys — the
  English string _is_ the key, so a missing entry falls back to itself and shows English on a
  Portuguese screen — to a catalogue key, written out rather than derived.

  `applyLocale` in `main.ts` replaces two call sites that set `state.locale` and repainted.
  Everything this app draws is re-read by `repaint`; the panel is not, because it is
  CodeMirror's DOM, so the editor is told separately.

  `NOT_ELEMENT_TEXT` in `e2e/window.desktop.test.ts` grows by all twenty-three, its largest
  single growth. The coverage it gives up is replaced twice: `search-phrases.test.ts` holds
  every key to a catalogue entry that differs between the two languages, and
  `packages/editor/src/search.test.ts` mounts the real panel and reads the words back off it.

  **This was a second file rather than a second line in the editor's changeset**, and at the
  time that was not style. Changesets v3 treated a private package as _ignored_ and refused a
  changeset naming an ignored and a published package together — `Mixed changesets that contain
both ignored and not ignored packages are not allowed` — after one file naming both took the
  release workflow down on `main` (TYTO-0). TYTO-94 turned private versioning back on, so the
  refusal has nothing left to refuse and one file is fine again.

- 243d596: TYTO-108 — the artwork stays on screen when the brief stops compiling

  Typing a stray character used to blank the preview, at the one moment the preview is the
  thing telling you whether the fix worked. Now the artwork stays and says it is older than the
  text being written.

  **The marker is the feature; keeping the pixels is the easy half.** A preview that silently
  showed old art would answer "did my fix work" with yesterday's answer. It reads as a state of
  the pane rather than as a second error message — the problems panel already lists what is
  wrong — and it sits inside the preview stage so that it is legible with that panel closed,
  which is the case this card is about.

  **Derived, not stored.** `DocumentState` gains `renderedBrief`, the text the current frames
  came from, and `isStale` is `frames.length > 0 && renderedBrief !== brief`. There is no flag
  for one code path to set and another to forget: a compile that starts working again clears the
  marker on the answer that fixes it. A brief that has never rendered is empty rather than
  stale, which is the case a boolean would get wrong on a new tab.

  **The discriminator is the errors, not the empty list.** A brief that compiles to nothing is a
  legitimate answer and clears the pane; frames are kept only when the compile actually failed.

  What it deliberately does not do: render partial output — that is TYTO-107 — keep frames
  across a reopen, or change what `brief:preview` sends.

- b5c689b: TYTO-99 — open and save `.brief` files, and the folder that comes with one

  Until now the Tyto window could compile a brief and show it, and could not keep it: close
  the app and the text was gone. This adds opening, saving and a recent list — and, because a
  file has a folder, it is also what makes a brief's images appear.

  **Main holds the path and the renderer never does.** The renderer asks to open something and
  gets back text and a name; where the file is stays in main, which is the only side with a
  disk. That is not ceremony: it is what lets the preview resolve `assets/logo.png` without the
  renderer ever learning a folder. The one place a path crosses the bridge is a recent entry,
  and main refuses any path that is not already in the list it wrote — so a renderer asking for
  a file nobody offered gets the same answer as one asking for a file that was deleted.

  **The recent list is commands, not a menu.** E9.12 built the list a person types into; ten
  files are ten entries in it, reachable with `Mod-K` and no panel open. An entry whose file has
  moved is reported in the problems panel — the same place every other "why is this not
  working" already goes — rather than vanishing on the one click that would have explained it.

  **Images start working, and that took two ports rather than one.** Resolving told `resolve`
  that `assets/logo.png` exists; the exporter still had nothing to embed and reported
  `E_EXPORT_ASSET_UNRESOLVED` for a file that was right there. Reading the bytes between
  `compile` and the export is the other half, and the end-to-end suite is what found it.

  `Mod-s` finally does something: `@tyto/editor` has bound it to `editor.save` since E8.3 and
  no host had registered the command. `Mod-o` and `Mod-Shift-s` are the desktop's own
  additions — and deliberately **not** offered in vim mode, where `vimMode()` replaces the
  whole input layer, so the command bar shows no shortcut for them there rather than promising
  one that does nothing.

  The window title carries the file name and says `(não salvo)` in words rather than with a
  bullet, which is nothing at all to a screen reader.

- f7afdf7: TYTO-100 — Lit for the renderer, and a window whose layout can become data

  The framework question had been pushed twice with nobody owning it. It is answered in ADR
  0024, with the problems panel rebuilt on the answer so that the decision ships as code and
  not only as a document.

  **What was measured, and what it said.** A repaint costs 4.9 ms today and 9.3 ms with ten
  panels in the window, inside a 16.7 ms frame — so nothing about speed forces a framework at
  the size being planned. The `[data-i18n]` walk, which the card named as the worry, is 1 % to
  5 % of that; the cost is `stageBox()` forcing a synchronous layout after the other painters
  have dirtied the document. What does force the change is that a panel today is a `<div>` in
  `index.html` plus a `getElementById` plus a bespoke painter, and none of those three can be
  written down as a record — which is what a window with panels a person shows, hides and
  resizes needs a panel to be.

  **Lit, over Preact and over staying hand-written.** The same panel built three ways: changing
  one diagnostic of two hundred costs 1.62 ms hand-written, 1.11 ms on Preact and 0.14 ms on
  Lit, and both component models keep the DOM nodes of the rows they did not change where
  `replaceChildren` could not. Lit also needs no build knob — no JSX transform in the three
  configs that declare this package's two-runtime split — and renders into light DOM, so
  `shell.css` still reaches inside every panel.

  **`<tyto-problems>` replaces `paintProblems`.** It owns its own strings, so changing the
  locale is a property change rather than a second pass over the document, and it hands a
  clicked row's range straight to the callback — the two `data-range-*` attributes and the
  `closest()` that parsed them back out are gone. Rows are keyed by the diagnostic's code and
  span and never by index, so fixing one error does not repaint the ones below it.

  **The renderer will not run in a browser tab.** Five comments said it would; ADR 0024 retires
  that premise and says what replaces each of them. A template's `preview.png` still crosses
  the bridge as bytes and `window.tyto` is still optional, for reasons that never depended on
  it. The window still has a browser tab's powers and not a Node process's, and the pure
  packages still run in any runtime — those two are untouched, and they are the ones that
  actually make the cloud possible.

  The bundle grows 24.8 kB, or 2.3 %, on a renderer CodeMirror already dominates.

- d8a2264: TYTO-115 — the workspace owns the text, which is what unblocks two cards that could not be
  written

  Nothing on screen changes, and that is the acceptance criterion rather than a disclaimer:
  `pnpm --filter @tyto/desktop test:desktop` passes with no test edited and none added, 76 of 76.

  **Five call sites used to ask CodeMirror what the document said** — the template picker's
  repaint, the save, the picker's `change` handler, the debounced compile and the first compile
  on load. Each of them was therefore an answer only the _active_ document could give, because
  `DocumentState.snapshot` was a copy refreshed when a document stopped being active and stale
  on purpose for exactly as long as it was in front. All five read `activeText()` now, and the
  recount is **0 of 5** left reading the pane. `panel.ts`'s `view.state.doc.length` stays, and
  is not one of them: clamping a range before revealing it in a viewport is the view's own
  question.

  `DocumentState.snapshot` is replaced by two fields that are not the same thing.
  `state` is the document — text, undo history and cursor — written by an `onUpdate` listener
  on every transaction. `scroll` is where the pane was looking, still captured at a hand-off,
  because scroll belongs to the view and two views on one document scroll independently (D7),
  and because reading it costs a layout flush that a keystroke should not pay.

  **Why this is a card of its own**, against the exploration's advice to fold it into a
  feature: it is behaviour-preserving and its evidence is silence, while TYTO-112 deliberately
  inverts an end-to-end expectation. Done together, nobody could tell which half moved that
  test.

  What it does not do: derive the unsaved marker (TYTO-112, which this unblocks), restore a
  session (TYTO-113), or allow a second editable view on one document (D2).

- 06dc650: TYTO-101 — the dock: a panel is a record, and a person can show, hide and resize it

  The window used to be a room with the furniture nailed to the floor. `index.html` declared
  an editor on the left, a preview on the right and a problems panel underneath, and `main.ts`
  held fifteen `getElementById` calls resolved before anything was on screen — which is exactly
  what stopped a panel from ever having a position that could change.

  **Now nothing in the markup says where a panel goes.** `index.html` declares four empty docks
  and a splitter each; `shared/layout.ts` holds one entry per panel — which element, which
  dock, open or not, how wide — and the dock builds the window from it. Adding the templates
  list or the queue is an entry and an element, with no change to the dock, the stylesheet or
  the window. The left dock is already there and empty for exactly that reason.

  **What a person gets:** a close button on every panel that has one, the same panels back from
  the command bar (`Mod-K`, "Mostrar ou esconder: Problemas"), and a splitter to drag between
  any two docks. All of it is remembered — close the problems panel, drag the preview wider,
  quit, reopen, and the window comes back the way it was left. "Restaurar a disposição padrão"
  is a command rather than a button, so it is reachable with every panel shut, which is when it
  is most needed.

  **The editor cannot be closed, and that is a field rather than a rule.** Closing its panel
  unmounts CodeMirror and destroys the buffer; E9.8 gave it somewhere to save to but nothing
  asks before discarding, and there is still no second tab to keep it in. When either lands,
  `fixed: false` is the whole of the change.

  Two things were found by opening the window rather than by a test, which is now the fourth
  time on this app. Sixty-four pixels of dead space between the panes and the bottom dock,
  because the shell's own 24px gap was still being added on both sides of a 16px splitter. And
  `Mod-K` stopped opening the command bar after the first time a panel was closed: the window
  listener was being registered again on every rearrange, so two of them toggled the bar twice
  inside one keystroke and it never appeared.

  The repaint measurement from ADR 0024 was re-run against the real panels and the ADR now
  carries both numbers. The conclusion holds — the forced layout is the expensive half and the
  `[data-i18n]` walk is not — and the magnitudes were overstated: the synthetic document had
  944 elements where the real window has 115.

### Patch Changes

- @tyto/io@1.3.1
  - @tyto/pipeline@0.7.1
