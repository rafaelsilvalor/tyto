# @tyto/editor

## 0.6.2

### Patch Changes

- Updated dependencies [353c83d]
  - @tyto/core@0.22.2
  - @tyto/brief-lang@0.6.2
  - @tyto/template-lang@0.6.2

## 0.6.1

### Patch Changes

- 91b6bc5: Dependency bumps in the prod group: `yaml` 2.9.0 → 2.9.1, `zod` 4.6.1 → 4.6.5, and
  `@codemirror/commands`, `@codemirror/state` and `@codemirror/view` to their latest patches.

  These are dependencies of what ships, so they get a patch and a line in the changelog rather
  than passing through unnamed. Written by hand because Dependabot cannot write a changeset — it
  has no idea this repository uses them — which is what makes every one of its PRs arrive red on
  `changeset status`. TYTO-155 is the card for fixing that properly.

- Updated dependencies [91b6bc5]
  - @tyto/brief-lang@0.6.1
  - @tyto/core@0.22.1
  - @tyto/template-lang@0.6.1

## 0.6.0

### Minor Changes

- d8a2264: TYTO-115 — a host can hold the document, and the view becomes a viewport onto it

  `EditorHandle` stops handing out an opaque `DocumentSnapshot` and hands out the thing itself.
  `state()` is the document of record, `onUpdate` delivers the state of every transaction, and
  `textOf(state)` reads a document without a view — which is the point: a host with tabs can
  now answer "what is in this buffer" for every buffer it holds rather than only for the one
  CodeMirror happens to be showing.

  **The order inside the update listener is the mechanism, not a detail.** `onUpdate` fires
  before `onChange`, so a host that reads its own store from `onChange` finds the text of the
  transaction that has just run. Both listener sets live in one `EditorView.updateListener` for
  that reason; two of them would leave the order to the extension array. Perturbing it — the
  store told last — fails two unit tests here and five end-to-end tests in the desktop.

  **Breaking, and the migration is four names.** `snapshot()` becomes `state()`, the scroll it
  used to carry comes from `scroll()` on its own, `restore(snapshot)` becomes
  `restore(state, scroll?)` with the scroll optional, and `blank(doc)` returns an `EditorState`
  rather than a pair. `EditorState` and `ScrollPosition` are exported so a host still declares
  no `@codemirror/*` dependency to name what it is holding.

  **`EditorState` is exported as a local alias, not as `export type { EditorState }`**, and the
  difference is not style. The re-export form reads correctly in the source and comes out of
  tsup's declaration rollup as `export { EditorState } from '@codemirror/state'` with the
  `type` modifier dropped — so the published `.d.ts` promised a value the bundle does not carry,
  a consumer writing `import { EditorState } from '@tyto/editor'` typechecked clean and failed
  at link time. Measured on the built `dist/`, fixed by `export type EditorState = …`, and the
  probe now stops at `TS2693: 'EditorState' only refers to a type`.

  **The scroll hand-off is asserted on the effect, because nothing else could.** jsdom has no
  layout, and the end-to-end suite turned out not to cover it either: with `restore` changed to
  drop the scroll it was given, `e2e/tabs.desktop.test.ts` passes 17 of 17, because restoring
  the selection scrolls the view to the caret and that satisfies its `scrollTop > 0`. The new
  unit test watches the effect reach a transaction through an ordinary listener, and fails on
  that mutation.

  `getValue()`, `setValue` and `onChange` are untouched: a host without tabs never needed any
  of this and still does not.

## 0.5.0

### Minor Changes

- 5309eb2: TYTO-107 — a stage may produce a value and still report errors

  A brief with one error anywhere used to render nothing. It now renders the slots that are
  fine and reports the one that is not, because severity and fatality are two questions and
  they were one field (ADR 0025).

  **`Ok<T>.warnings` is `Ok<T>.diagnostics`.** It no longer holds only warnings: a non-fatal
  error rides the ok branch beside the part of the value that survived. A code declares
  `fatal` beside `severity` in the catalogue, `fromPartial(value, items)` is what a stage with
  something partial to hand back returns, and `hasFatal` is the test. `fromDiagnostics` is
  unchanged and is still right for a stage with nothing partial to offer. `withWarnings` is
  `withDiagnostics`.

  **Severity still decides the exit code.** A partly rendered brief is `hasErrors` and fails a
  build; what changed is that it also writes its artifacts, so `result.json` is
  `status: error` with a non-empty `artifacts` — the state `docs/render-contract.md` now calls
  _rendered, with errors_.

  **`E_SYNTAX` split three ways**, because fatality is a property of the code: `E_SYNTAX` is a
  line of the brief body and is not fatal, `E_FRONTMATTER_SYNTAX` is the block that names the
  template and is, and `E_TEMPLATE_SYNTAX` is a `template.html` and is. `docs/diagnostic-codes.md`
  publishes the whole list with the reason for each entry.

  **A failed frame no longer costs the report.** `runJob` returns its `JobReport` with the
  errors riding along, so the eleven frames of twelve that rendered are listed rather than
  dropped — `result.json` used to say `artifacts: []` over a folder the same run had written
  nine files into.

  `E_MISSING_REQUIRED_SLOT` and the unresolved-export codes stay fatal on purpose: each would
  leave a hole in the artwork that nothing in the artwork names, and art that looks finished
  with a slot silently empty is the failure this card had to avoid.

### Patch Changes

- Updated dependencies [5309eb2]
  - @tyto/core@0.22.0
  - @tyto/brief-lang@0.6.0
  - @tyto/template-lang@0.6.0

## 0.4.0

### Minor Changes

- fe14104: TYTO-109 — find and replace, in the window's own language

  `Ctrl+F` did nothing until now: `@codemirror/search` appeared in no `package.json` and nothing
  in `packages/editor` imported it. A brief of three hundred lines had no way to find a word in
  it.

  **The panel is CodeMirror's, the words are the catalogue's.** That was the risk in the card
  and it was measured before anything was built: all seventeen strings `@codemirror/search`
  renders go through `EditorState.phrases` — eighteen `phrase(` call sites, one of them the
  helper, zero literals rendered any other way. So the panel is translated rather than replaced,
  and `packages/editor` still ships no words of its own. `EditorOptions.searchPhrases` is the
  one place it takes any, because a panel cannot be translated at the point of display the way
  a command label is.

  **Six commands, on the registry rather than beside it.** `searchKeymap` dropped in whole would
  have added seven bindings the command bar knows nothing about, and `bindingsOf` reads its
  keystrokes off the registry's set — the bar would have gone on claiming those keys did not
  exist while they worked. So `createCommandRegistry` registers find, find next, find previous,
  replace, replace all and go to line, and `defaultKeymapSet` binds the four CodeMirror binds.
  **Replace gets no keystroke**: the panel has one opener with the replace fields inside it, so a
  second binding would be a second name for `Mod-f`, and the bar shows an entry with no key
  rather than an invented one.

  **Escape and `Mod-g` inside the panel stay CodeMirror's.** A registry binding carries the
  default `"editor"` scope and the panel's input is not the editor, so those are a small
  panel-scoped keymap beside the registry's rather than a second table.

  **In vim mode there is no panel, and search still works.** Finding is `/`, `?`, `n` and `N`,
  and `@replit/codemirror-vim` drives the _same_ `SearchQuery` state — so a `/carrossel` typed
  in vim is still in the field when the panel is opened later. That holds only while there is
  one copy of the package, which is why `@codemirror/search` is now a direct dependency pinned
  to the version vim had already resolved. It was already in the shipped bundle as vim's peer,
  so this adds no download and no weight.

  The phrases live in a state field reading a mutable holder rather than in a compartment, so a
  tab opened after a language switch is born in the new language; `restore` re-dispatches for
  the other direction, where a tab that was away carries a snapshot from before the switch.

## 0.3.1

### Patch Changes

- 1ee96d4: TYTO-114 — completion stops going silent past the first 3 000 characters

  A test that failed 2 runs in 9 turned out to be the visible half of a defect that is
  deterministic on any document long enough to have the problem.

  **`syntaxTree(state)` returns whatever the last parse finished, which is not the whole
  document.** CodeMirror gives the initial parse a viewport of `Math.min(3000, doc.length)` and
  a 20 ms budget, and on expiry `takeTree()` truncates the tree wherever the parser stopped
  (`@codemirror/language/dist/index.js:540`). Past that point `resolveInner` answers with the
  top node instead of the node the cursor is in, every reader falls through to its `default:`,
  and the author gets nothing — which reads as "no suggestions" and is really "no tree".

  Measured on real documents, before the fix:

  | document          | length | tree      | node at cursor | suggestions       |
  | ----------------- | ------ | --------- | -------------- | ----------------- |
  | 200-line brief    | 2 942  | 2 942     | `Adjustments`  | `destaque`, `tom` |
  | 400-line brief    | 5 942  | **3 013** | **`Brief`**    | **none**          |
  | 200-line template | 4 103  | **3 005** | **`Template`** | **none**          |

  **Five readers shared the defect**, not one: brief completion, template completion in three
  places (the tag list, the stylesheet test and the open-quote walk), and the template linter's
  "which tag is this attribute on" climb. All five now go through `treeAt(state, upto)`, which
  asks `ensureSyntaxTree` for a tree that actually reaches the position and falls back to the
  partial one if a 100 ms budget is not enough — today's behaviour, degraded rather than broken.

  The budget is measured rather than picked: forcing the parse to the end of a 14 942-character
  brief costs 5.9 ms, and to the end of a 20 903-character template 6.8 ms.

  **The 20 ms is wall clock, not CPU time**, which is the other half of the same defect and the
  reason it first appeared as a flake: a worker descheduled under load blows the budget on a
  document of any size. That is why the test failed only when the other eleven files in the
  package ran beside it, and never when it ran alone.

## 0.3.0

### Minor Changes

- 595c303: TYTO-93 — completion reads the syntax tree, in both languages

  Both completion sources used to decide where the cursor was by matching the text before it
  with a regular expression. That made the editor a second reader of a syntax this repo already
  ships a parser for, written twice — once for the brief, once for the template. Both now walk
  `syntaxTree(state).resolveInner(pos, -1)` and answer by node.

  What changes for somebody writing a file:

  - `slot="…"` inside a `<text>` or an `<image>` now offers the slots the active manifest
    declares, with each slot's type beside it. Pointing the editor at another manifest changes
    the list. `templateLint` publishes that manifest to the editor state, so the squiggle and
    the completion list are always talking about the same template.
  - A `<` typed inside an attribute value is a character in a value and no longer offers the
    tag list, and a `::` on an indented body line is body text and no longer offers the slot
    list. Both were cases a regular expression had to be taught by hand.
  - A `>` already written puts the cursor outside the opening tag, so attributes stop being
    offered in an element's body; a property is offered at the start of a declaration and not
    where a selector goes.

  `TemplateAnalysis` now carries the `manifest` it was computed against, and
  `templateAnalysisField` / `setTemplateAnalysis` are exported beside the brief's equivalents.
  A host that mounts `templateCompletion()` without `templateLint()` keeps everything but the
  slot list.

  One text match survives, in each language, and both are places the grammar leaves nothing to
  read: the brief's frontmatter is one opaque token whose YAML a real parser handles elsewhere,
  and an unterminated attribute value in a template is an error node with no structure under
  it. The tree still says which frontmatter block and which attribute, which is the part that
  used to be guessed.

### Patch Changes

- 4fad5b9: Quick fixes reach the three cases they were missing (TYTO-92).

  **An adjustment that carries a value is fixable.** `E_BAD_ADJUSTMENT` is ranged over
  `name: value` for an enum, and the whole-range guard refused it rather than rewrite the
  author's value. The editor now cuts at the first colon — exact, not approximate, because
  the grammar forbids a space in front of one — and replaces only the name: `{tomm: claro}`
  becomes `{tom: claro}`.

  **A property the alias table knows gets a button, not only a message.** `background` is not
  a typo of anything, so no edit distance would ever find `fill`.
  `@tyto/template-lang` now exports `propertyAlias`, `tagAlias` and `attributeAlias`, each
  filtered to the entries that name exactly one accepted thing — the multi-word ones ("x, y
  and rotation") stay in the message, which is where a sentence belongs.

  **An attribute on the wrong tag gets one too.** Which attributes are legal is a question
  only the tag answers, and `E_UNSUPPORTED_ATTRIBUTE` does not carry the tag as a field. The
  editor climbs from the diagnostic's range to the enclosing `Element` in the tree it already
  has, rather than the diagnostic growing a field for one consumer. `object-fit` is offered as
  `fit` on an `<image>` and refused on a `<rect>`, which does not take it.

  Also: the editor's test run no longer prints a jsdom `TypeError` from CodeMirror's measuring
  pass on every test that draws a marker.

- Updated dependencies [4fad5b9]
  - @tyto/template-lang@0.5.0

## 0.2.0

### Minor Changes

- 4032fe0: Command registry, keymap layer and vim mode (TYTO-38).

  `createCommandRegistry()` is the Command pattern `docs/architecture.md` puts in the editor:
  every action has an id, keymaps bind ids rather than functions, and E7 hands a plugin the
  same `register` the built-ins use. A binding to an id nobody registered falls through
  instead of failing, so shipping a `Mod-s` binding before anybody implements saving costs
  nothing.

  **There is one undo stack, and CodeMirror's history is most of it.** A command that changes
  something outside the document declares an `undo` and joins the stack; the text history's
  own `undoDepth` is the clock that keeps the two in order, so nothing here counts keystrokes
  and nothing can disagree with CodeMirror about how many events a burst of typing was. A
  command that edits the document must **not** declare an `undo` — the history already owns
  text, and the registry throws rather than letting an undo overshoot by one edit.

  `vimMode()` brings `@replit/codemirror-vim` (ADR 0006) in through the same registry: `:w`
  and `:render` are ex-commands that dispatch ids, and the engine's `u` and `Ctrl-r` are
  pointed at the registry so vim does not get a second, shallower undo that skips app-level
  commands. `EditorHandle` gains `runCommand`, `setVimMode` and `isVimMode`; the toggle is a
  compartment reconfigure, so the document, the cursor and the undo stack all survive it.

  `EditorOptions` gains `commands`, `keymap` and `vim`. `defaultKeymapSet` and `vimKeymapSet`
  are the two built-in sets.

- c341c0f: Inline diagnostics and manifest-driven autocomplete (TYTO-37).

  `briefLint(analyzer)` turns every `Diagnostic` `parse` and `resolve` produce into a
  CodeMirror lint marker — same code, same message, same span, because a `SourceRange` is
  already the pair of UTF-16 offsets CodeMirror consumes and nothing is converted on the way
  in. A diagnostic whose range covers exactly a name carries a quick fix built from
  `didYouMean` in `core`, the same function and budget that produced the message's own hint,
  so the button and the message can never name different slots.

  `briefCompletion()` reads the manifest the frontmatter named and offers slot names after
  `::`, adjustment names inside `{}` filtered by their `applies`, enum values after `:`, and
  format ids in the frontmatter list. Nothing is hard-coded: change `template:` and every
  list in the file changes with it.

  Both are fed by one `BriefAnalyzer`, the port the host fills. `createBriefAnalyzer` runs
  the two stages in process; `createWorkerAnalyzer` and `serveBriefAnalysis` are the two
  halves of a worker protocol for a host that would rather not parse a twelve-slide brief on
  the thread that paints the caret. The package constructs no worker — that is the bundler's
  business and therefore the host's.

  Two diagnostics deliberately never reach the gutter: `W_TEXT_OVERFLOW`, because the editor
  does not `compile` and compiling executes a third party's template, and
  `E_ASSET_NOT_FOUND`, unless the host passes an `AssetResolver` — a renderer cannot see a
  disk, and underlining every image path in a brief that renders fine from the CLI would
  teach an author to ignore the gutter.

- 02e22ec: The template language in the editor (TYTO-39).

  `template()` is the second `LanguageSupport` this package ships, and `createEditor` takes
  `language: 'brief' | 'template'` to choose between them — a name rather than a
  `LanguageSupport`, so a host still never imports CodeMirror. It is fixed for the life of an
  editor: a buffer is a `.brief` or a `template.html`, and opening the other one is opening
  another file.

  The grammar is the one `compileTemplate` parses with and the colours are
  `templateHighlighting`, which lives beside it. Folding collapses an element to its opening
  tag, a rule to its selector and the whole stylesheet to `<style>`. Both themes grew the
  palette the second language needs — and four tags turned out to be shared with the brief
  outright, which is the tag vocabulary doing its job.

  `templateLint(analyzer)` puts `compileTemplate`'s diagnostics in the gutter, with a quick
  fix for a name edit distance can reach. `templateCompletion()` offers tag names after `<`,
  the attributes the tag being written accepts, and CSS properties inside `<style>` — out of
  the same arrays the compiler refuses against, so a name the editor offers is a name the
  compiler accepts by construction.

  `createTemplateAnalyzer({ manifest })` is the port, and it takes **the template's own**
  manifest rather than a registry: a brief names its template in the frontmatter, a
  `template.html` is the file beside a `manifest.yaml`, and only the host knows which.

  The demo now opens all four built-in files — two briefs and two templates — and the
  diagnostic-to-marker mapping the brief linter had is shared with this one rather than
  written twice.

## 0.1.0

### Minor Changes

- aa6c851: CodeMirror 6 with the brief language (TYTO-36).

  `@tyto/editor` has an API: `createEditor(parent, options)` mounts an editor and hands back
  `getValue`, `setValue`, `onChange`, `setTheme`, `destroy` and the `EditorView` underneath.
  The renderer, the demo page and a web build all mount one the same way, and none of them
  imports CodeMirror — a React wrapper in `apps/desktop` is a `useEffect` around four methods.

  The language is the grammar `@tyto/brief-lang` already ships, configured rather than
  described a second time, so the editor and the compiler cannot disagree about what a brief
  means. Folding is the one thing this package adds to the tree: a directive with an indented
  body folds to its first line, and one with an inline body does not fold at all because there
  would be nothing left to show.

  `onChange` reports what the author typed and stays quiet when the host writes. `setValue`
  carries an annotation the update listener reads, which is what keeps E9.2 from saving the
  file it has just opened.

  Two themes, swapped through a compartment so switching does not rebuild the state. What they
  carry is the chrome and the syntax colours together — a host that could swap one without the
  other would get dark text on a dark background.

  **Five of the eleven entries in `@tyto/brief-lang`'s highlight table were wrong, and
  rendering it is what showed.** Three of them named `directiveMark`, `braceOpen`,
  `braceClose`, `markClose`, `boldMark`, `italicMark`, `adjustmentSep` and `valueSep`, and
  matched nothing: only a capitalised Lezer rule produces a node, so all eight were spelled
  after characters that have no name in the tree. And
  `Bold: tags.strong` reaches the two asterisks and not the word between them, because a tag
  stops at the first child unless it is written `Bold/...`. Neither mistake throws or warns.
  The table is respelled — punctuation through the construct that contains it, emphasis with
  `/...` — and `highlight.test.ts` now reads the spans a renderer receives instead of the
  table. Restoring the old spelling fails 5 of its 11 cases and 2 of the editor's 20.

  `packages/editor/demo/` is the acceptance criterion: `pnpm --filter @tyto/editor demo` opens
  the two example briefs the built-in templates ship, with a theme switch and a read-only
  toggle. It imports `createEditor` and nothing else, so anything it cannot do, `apps/desktop`
  will not be able to do either. `vite build` bundles it in 234 modules with no Node shim,
  which is the other half of the criterion.

  Not here: vim mode and the command registry (E8.3), lint markers and manifest-driven
  completion (E8.2), the template language (E8.4). The keymap is CodeMirror's defaults plus
  history and folding, and E8.3 replaces that layer.

### Patch Changes

- Updated dependencies [aa6c851]
  - @tyto/brief-lang@0.5.9
