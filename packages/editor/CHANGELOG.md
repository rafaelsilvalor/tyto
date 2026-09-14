# @tyto/editor

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
