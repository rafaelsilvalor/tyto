# @tyto/editor

## 0.13.0

### Minor Changes

- f0cd9b8: The key table has a seventh context, `terminal`: focus is in a terminal, with the command bar closed (TYTO-497, ADR 0164). `panel` no longer holds inside a terminal.

### Patch Changes

- 9021b50: Rename shadowing local bindings without changing behavior and enforce the no-shadow lint rule.
- 93fb9c9: A slide places several pictures where its body says (TYTO-498, ADR 0160 amended 2026-10-31). A manifest may declare `multiple: true` on a `per` image slot; then each `::imagem` after the same `::lamina` adds a picture, its first line is the path, and the indented lines under it continue the slide's body. The slide's value carries `blocks`, its body in order with the pictures among the text; `value` and the slot under its own name are unchanged, so a brief and a template written for one picture per slide render the same. The editor marks such a slot `multiple` when it completes `::`, and the manual's carousel page says how to write it.
- Updated dependencies [9021b50]
- Updated dependencies [93fb9c9]
- Updated dependencies [147eafa]
- Updated dependencies [05c9f83]
  - @tyto/core@0.36.0
  - @tyto/template-lang@0.8.8
  - @tyto/brief-lang@0.7.7

## 0.12.1

### Patch Changes

- fc3bee5: Tests and comments stop naming the production templates as if they were built in (TYTO-436): a test's template name is invented or one of the pack's test templates, and a comment about a template in its own repository names the repository. No behaviour changes.
- Updated dependencies [fc3bee5]
- Updated dependencies [04233fc]
- Updated dependencies [6881557]
- Updated dependencies [4168183]
  - @tyto/brief-lang@0.7.6
  - @tyto/core@0.35.0
  - @tyto/template-lang@0.8.7

## 0.12.0

### Minor Changes

- b7c5136: A slide carries its own slots (TYTO-482, ADR 0160). A manifest slot declared `per: lamina` takes one value per slide, written as `::imagem` after that slide's `::lamina`; it resolves like any other image, a missing file is reported at that line, and a template reads `slots.imagem` as this slide's picture. `ResolvedArtwork` gains `slots` and `missingRequiredSlots`, and a required `per` slot stamps only the slide that lacks it. The editor marks the slot `per lamina` and the skeleton writes it under every slide.

### Patch Changes

- 0164874: `tyto delivery new <name> [--template <name>]` makes a delivery: one folder per piece of work, named after its ticket, with `assets/`, `editaveis/` and the brief as `editaveis/<name>.brief` (TYTO-489, ADR 0157). The project file and a work profile gain the `delivery` key (`parent`, `folders`, `brief`, `exports`, `formats`, `types`), merged one subkey at a time; `parent` stays inside the workspace folder for every sheet. An existing delivery folder is reused, an existing brief is refused with `E_DELIVERY_BRIEF_EXISTS` and nothing written, and a name a folder cannot have is `W_DELIVERY_NAME_INVALID` (ADR 0114's profile rule, up to 100 characters, NFC). `@tyto/core` now holds `briefSkeleton` and `skeletonText`, which `@tyto/editor` re-exports unchanged.
- Updated dependencies [503f924]
- Updated dependencies [6d431f6]
- Updated dependencies [eca9871]
- Updated dependencies [b7c5136]
- Updated dependencies [b40dea8]
- Updated dependencies [0164874]
- Updated dependencies [cd14464]
  - @tyto/core@0.34.0
  - @tyto/brief-lang@0.7.5
  - @tyto/template-lang@0.8.6

## 0.11.0

### Minor Changes

- 4a1455e: TYTO-467: "New brief from template…" and the "/" menu say when a name is an alias. The row's line reads what it stands for, `aviso · laranja` (in the "/" menu, before what choosing it does), and the plugin file that declares it is on hover in the bar and in the panel CodeMirror opens beside the highlighted "/" row. `templates:list`'s `alias` carries that `file`. In `@tyto/editor`, a `SlashItem` may carry `info`, passed to the completion as CodeMirror's own. A template that is not an alias shows as before.

### Patch Changes

- Updated dependencies [f612e26]
- Updated dependencies [096f80e]
  - @tyto/core@0.33.0
  - @tyto/brief-lang@0.7.4
  - @tyto/template-lang@0.8.5

## 0.10.0

### Minor Changes

- 303c2dc: TYTO-440: the desktop's New brief from template and "/" menu write what a plugin file's configuration says about a new brief. `templates:list` rows carry `configured` (the configuration's `skeleton`, `formats` and the slots it fills) for the template's own name and each alias. `@tyto/editor`'s `briefSkeleton` takes it as `SkeletonManifest.configured`: a configured skeleton is written whole, its `template:` line naming the row picked; without one, the computed skeleton uses the configured formats and leaves out the filled slots. The window shows `W_SLOT_OVER_CONFIGURED_LIMIT` like any other warning. The manual's Plugins page says so in both editions.

### Patch Changes

- Updated dependencies [c590e01]
- Updated dependencies [e7588e9]
- Updated dependencies [4388575]
- Updated dependencies [e2b72a7]
  - @tyto/core@0.32.0
  - @tyto/brief-lang@0.7.3
  - @tyto/template-lang@0.8.4

## 0.9.2

### Patch Changes

- Updated dependencies [a5912e7]
  - @tyto/core@0.31.0
  - @tyto/brief-lang@0.7.2
  - @tyto/template-lang@0.8.3

## 0.9.1

### Patch Changes

- Updated dependencies [7115286]
- Updated dependencies [46a0b89]
  - @tyto/core@0.30.0
  - @tyto/brief-lang@0.7.1
  - @tyto/template-lang@0.8.2

## 0.9.0

### Minor Changes

- dcd1757: A recipe opens as a notebook: under each cell, its table (20 rows, then how many more), when it ran and how old its data is, a fold toggle, **Run from here** and, on a cell that fetches, **Fetch again**. Two commands do the same from the keyboard, Run recipe from this cell and Run recipe, fetching again. `@tyto/editor` gains `remeasureCellOutput`, for an output whose height changed in place.

## 0.8.0

### Minor Changes

- 7cf6a11: TYTO-120: `hasBeenEdited(state)` says whether a document's undo history holds anything. A document `blank()` built answers `false`, and so does one undone all the way back; one typed into and then emptied answers `true`, which `textOf(state) === ''` cannot tell apart from a fresh one.
- c141ec9: TYTO-206, PR B: "Preferences: Open Settings (JSON)" opens `settings.json` in a tab. Its problems
  show in the problems panel while you type, a save from the tab or any editor applies with no
  restart, and a screen's change goes into the tab's unsaved buffer instead of the disk. A screen's
  change to a file that does not parse is refused, undone and shown. `@tyto/editor`'s `blank`
  takes an optional language for one document, without the host's language extensions.
- 7342c02: TYTO-207 (ADR 0074): every key the window answers now comes from one keybinding table. `@tyto/editor` gains a pure resolver (`parseKey`, `resolveKeybindings`, `keymapSetFor`, `windowBindingsOf`, `shownBindingsOf`) over six closed contexts, `vimMode` and `createEditor` take their vim set as an option, and `setKeymaps` swaps both modes' bindings in place. `plugin-api`'s `editor.keymap` gains an optional `when` and is consumed by the desktop for the first time. `core` gains six codes (`E_KEYBINDINGS_SYNTAX`, `W_KEYBINDING_UNKNOWN_COMMAND`, `W_KEYBINDING_INVALID_KEY`, `W_KEYBINDING_UNKNOWN_CONTEXT`, `W_KEYBINDING_DUPLICATE`, `W_KEYBINDING_LOCKED`). The desktop's `Mod-K` listener becomes a window dispatcher for global keys, registered once. No default key changes.
- b713378: TYTO-247: a `markdown` language, coloured by `@lezer/markdown` with GitHub's extensions (tables, strikethrough, task lists), and `markdownToHtml(text)`, which draws a Markdown text as HTML sanitised by construction: only a list of tags, every character escaped, raw HTML as text, links with no `href` and images as their alt text.
- 752ddd2: TYTO-248: `EditorHandle.onVimStatus` reports vim's mode and pending keys from the library's public events, and `null` while vim is off, for a host that draws its own status bar; `EditorOptions.vimStatus: false` turns the library's own status line off. `cursorOf(state)` reads the line, the column and the selected character count off a state the host holds.
- 0dd0e56: TYTO-256: a fourth `LanguageName`, `json` — JSON with comments, coloured with the highlight tags the brief and template languages already use: keys, string values, numbers, `true`/`false`/`null` and both kinds of comment. A stream tokenizer, with no new dependency; `json()` and `jsonLanguage` are exported beside `brief()` and `template()`.
- 0dd0e56: TYTO-256: `withDiagnostics(state, diagnostics)` and `EditorHandle.showDiagnostics(diagnostics)` put a host's diagnostics on a document as lint markers, in any language — a `plain` buffer with no linter of its own included — replacing the ones it had; they map through later edits and stay off the undo history. They take `MarkedDiagnostic`, the five fields a marker needs, which a Tyto `Diagnostic` satisfies.
- 9bd7527: TYTO-258: CodeMirror's own search panel, completion list, lint tooltip and diagnostic underlines are painted from the host's tokens, like the buffer. `themeTokens` grows by the roles they read — `surface-raised`, `hairline`, `border`, `focus-ring`, `hover`, `button-on`, `error`, `warning`, `info`, the type size, radius and widths among them — so a host must define those too. The underline under a diagnostic is a wavy text decoration in the severity's token instead of CodeMirror's drawn image, and a search match is outlined rather than filled.
- 99f185d: TYTO-265: `ScrollPosition` is plain data now — `{ top }`, the document offset of the line at the top of the pane — so a host can write it down and hand it back after a restart; `restore` puts that line at the top, clamped to the text. Within one run `restore` still puts the pane back to the pixel. `selectionOf(state)` reads the main selection as `{ anchor, head }`, and `withSelection(state, selection)` puts one back, clamped to the text and off the undo history.
- c17b976: TYTO-272: the editor's text size is the host's `--tyto-code-size` (`codeSize` in the theme, listed in `themeTokens`). New `EditorHandle.remeasure()` and `remeasureText(view)` make every pane read its line height and character width again after the host changed the face or size, and the indent guides and the pinned head lines redraw on it — a new face at the same size used to leave the guides off their columns.
- 922caa8: TYTO-273: `breadcrumbOf(state)` and `breadcrumbAt(blocks, pos, slice)` name the block the caret is in — a directive's label, or the frontmatter with the key on or above the caret's line — read off the list of `blocksOf`; nothing between blocks, after a block's last text line or on a comment. `directiveLabel` names a directive block as `::lamina 2` wherever it is listed.
- 2d32db1: TYTO-275: a new brief from a template, built from its manifest. `@tyto/editor` exports `briefSkeleton`, which turns a manifest's required slots — and a repeated slot with a minimum of one — into a CodeMirror snippet whose fields Tab walks, `skeletonText` and `insertBriefSkeleton`; an enum value that is selected now completes to every value. The desktop's "New brief from template…" (Ctrl+K and the File menu) lists every template with its folder and description and opens the chosen one's skeleton in a new tab, and choosing a template in the picker on an empty brief writes the same skeleton. `templates:list` carries each template's slots and its folder.
- c9c17a3: TYTO-276: a "/" at the start of a line lists templates. `@tyto/editor` exports `slashCompletion(sources)`, `completeSlash`, `openSlashMenu` and the `slashRequested` effect: a "/" in column 0 of a brief, outside the frontmatter and with nothing after the cursor, opens a list of the rows each `SlashSource` hands it; typing filters, Enter replaces the "/" and the query, Escape leaves the "/", and `//` stays a comment. The desktop lists its templates there — the skeleton into a brief holding only the "/", or a switch of `template:` in one undoable edit on a brief with content, the row saying which — and registers `editor.insertMenu`, brief-only and with no default key, to open the same list from a binding in `keybindings.json`.
- 2495d0d: TYTO-277: snippets in the brief editor. `snippetTemplate(body)` translates a VS Code snippet body into a CodeMirror `snippet()` template — `$1`, `${1:default}`, `$0`, escapes, every literal brace escaped — and refuses what it cannot say (variables, transforms, nested fields) by name; a choice becomes its first option. `briefSnippets(get)` offers them in completion on a word that starts its line, outside the frontmatter, and `snippetsSlashSource` lists them in the "/" menu; a snippet with `forTemplate` is offered only while the brief names that template. `tabThroughCompletions()` makes Tab and Shift+Tab step through an open completion list, falling through to a snippet's fields or to indenting when none is open. The "/" menu's sections now keep the order the host gave its sources.
- d84eaa1: TYTO-285: remove `EDITOR_RENDER` (`editor.render`), its `Mod-Enter` binding in both keymap sets and the `:render` ex-command. It was a placeholder from before the preview drew live, and no host ever registered it, so the key fell through to CodeMirror's `insertBlankLine` and `:render` did nothing. Removing a public export is a minor bump before 1.0. A host that wants a render command registers its own id and binds it.
- d755180: TYTO-286: the editor splits. Ctrl+\ opens the brief in front in a second group to the right, Ctrl+Shift+\ below (also on the View menu, in the command bar, and as `:vsplit` and `:split` in vim), and Ctrl+Alt+Left/Right moves between groups. Each group has its own row of tabs on top; the strip across the whole window is gone. The same brief can be open in two groups and typed into in either, with one undo history. The status bar, the problems panel, the preview and the title follow the group you are in. For now a window with several groups reopens after a restart as one group with every tab and draft. `@tyto/editor` makes several panes over one editor (`createPane`, `followerOf`, `isFollower`) and names the view in `onUpdate` and `onChange`.
- 3b9ca57: TYTO-293: the editor draws a thin vertical guide at each indent level, as VS Code does, and the
  guide of the block holding the cursor in a stronger colour. A blank line inside a block keeps
  the guide; one between two blocks breaks it. The guides appear in brief tabs, the JSON tabs
  (settings, keybindings, snippets) and both buffers of the template mode. `"indentGuides": false`
  in `settings.json` hides them on save, with no restart. Two theme tokens are new,
  `indent-guide` and `indent-guide-active`, set by every built-in and pack theme (42 tokens).
- 0255852: TYTO-295: while the top of the editor is inside a block, the block's head line stays pinned
  there — `::lamina` while scrolling its body, and in the template mode each element the top is
  inside, stacked. The row slides away with the block's last line, a click on it goes to the
  directive, and the caret is never left under it. `"stickyScroll": false` in `settings.json`
  turns it off on save. A directive's fold now ends at its last line with text.
- 49e985f: TYTO-296 (ADR 0095): "Go to Block…" (Ctrl+Shift+O, in both input modes) lists the brief's blocks in the command bar — the frontmatter as "cabeçalho"/"header", every directive as `::lamina 2` with its first words beside it — and moving through the list previews each one; Enter leaves the caret on it and Escape puts the caret and scroll back. Brief-only and on the View menu, which now greys what the tab in front cannot use. `@tyto/editor` exports `briefBlocks`, `blocksOf` and `blockAt`: the blocks read from the syntax tree, numbered only for a slot the manifest says repeats, and remembered per tree.
- 74d7b28: TYTO-297: `formatBriefInView` applies Format Brief as one undoable change that keeps the caret on its text, and refuses a brief with a syntax error without touching it. New `tabSize` option and `setTabSize`: spaces per indent level, for what Tab inserts, the tab width, the indent guides' step and the indent Format Brief writes, changed live in every pane. The indent guides now redraw when the indent unit changes with no edit.
- d61d96f: TYTO-298: the columns of a brief's `|` lines are told apart, read as a table template reads them: a `|` inside bold, italic or a mark does not split, columns restart on each line and at a `\` break, and emphasis keeps its own colour. New `briefColumns` option and `setBriefColumns` with four looks — `off`, `separator` (the default), `alternate` and `perColumn` — changed live in every pane, plus `columnMarks` for reading where a line splits.
- bf3fd0e: TYTO-304: `jsonAssist(source)` gives a JSON-with-comments tab a completion list and hover help
  from a host's plain answers — what can go at this position, and what the text under the pointer
  is — with a pick replacing the whole string being typed and leaving what the host asks for
  selected. The editor still knows nothing of what a file means. `EditorHandle.blank` takes a
  third argument, one document's own extensions, which a follower in another pane carries too.
- f244b75: TYTO-304: `KEYBINDING_CONTEXT_DESCRIPTIONS`, one sentence for each of the six keybinding
  contexts beside `KEYBINDING_CONTEXTS`, typed over the closed list so a context added without its
  sentence fails the typecheck. The keybindings tab suggests and explains `when` from it.
- e39f1d7: TYTO-305: Enter in a brief keeps the indent of the line it leaves, so a block is typed with one Tab and then Enter only. On a blank line after a line with text the blank line stays and the next line keeps the block's indent; on a second blank line in a row no line is added and the cursor goes back to column 0, where the next directive starts; from an empty line at column 0, Enter adds a plain new line. Shift+Enter, Tab, an open completion list and the frontmatter are unchanged, and JSON tabs and template buffers keep CodeMirror's Enter.
- 15e11fb: TYTO-377: the editor reads `.recipe` files. `createEditor({ language: 'recipe' })` colours a recipe line by line — the header, the `|` description, `param` lines, comments, the verb at the start of each line (a plugin's namespaced `jira.pull` included), `name=` arguments, quoted values, `{param}` placeholders and `@./file.json#/pointer` data references. `recipeCompletion(verbs)` offers the verbs the host names at the start of a line. `cellOutputs()` with `setCellOutputs` puts an element the host builds under a line, keeps it there while the text is edited, drops it when its line is deleted, and keeps the element of a key it already holds instead of building it again.
- 82e915d: TYTO-414: the cursor's line is no longer shaded while text is selected — a word picked with
  vim's `v`, a block from `Ctrl+V` or a drag with the mouse shows only the selection, as in VS
  Code. The shading comes back when the selection is empty; the line's number keeps its own.
- 82e915d: TYTO-415: a `lineNumbers` setting, as VS Code's `editor.lineNumbers`. `"on"` (the default)
  numbers each line, `"relative"` shows the cursor's line its own number and every other line its
  distance to it — what a vim count like `5j` moves — and `"off"` shows no numbers. It applies on
  save of `settings.json`, in every tab and the template mode, with or without vim.
- 4186112: TYTO-417 (ADR 0141): a plugin contributes vim mappings through a new `editor.vim` point, the seventeenth. `registerVim({ id, title?, mappings, ex? })` registers data only: each mapping binds `keys`, in an optional vim `context`, to an `operation` named by `@tyto/editor`, with optional `args`; each ex command runs a command id. It crosses an isolated plugin's boundary as data, and `registry.vim()` lists it. In `@tyto/editor`, `defineVimOperation(name, { kind: 'action' | 'operator', run })` names an operation and `setVimContributions(contributions, enabledIds)` maps the enabled contributions into the engine and unmaps the rest, per window and idempotently, so a switched-off key does what vim does by default again. A contribution that cannot be applied is left out whole with `E_VIM_CONTRIBUTION`, a new code in `@tyto/core`.
- 53d664d: TYTO-418 (ADR 0143): vim mode gains its first plugin, commentary, and a `vimPlugins` setting
  that switches each vim plugin by id. `@tyto/editor` ships a `comment` operator (CodeMirror's
  `toggleComment`, so a Markdown or template line is wrapped in `<!-- -->` where vim's own
  `gc` does nothing; Markdown's comment tokens now reach it), passes an operation's `isEdit` to the engine so `.` repeats an action, and hands a
  mapping's `<character>` key to the operation as `selectedCharacter`. The desktop's built-in
  plugin contributes commentary on `gc` through `editor.vim`, the window reads every contribution
  on `plugins:vim` and maps the ones the setting leaves on, which is all of them unless one is
  named `false`; a save of `settings.json` switches them in place. The manual's Vim mode page gains
  a Plugins section, in English and Brazilian Portuguese.
- 3da246d: TYTO-418 (ADR 0143 amendment): vim mode gains surround, on by default and switched by the
  `surround` id of `vimPlugins`. `ys{motion}{pair}`, `yss{pair}`, `ds{pair}`, `cs{old}{new}` and
  visual `S{pair}` add, delete and change brackets or quotes around text; an opening bracket adds
  a space inside, and `.` repeats with the same pair. `@tyto/editor` ships it as two operations,
  an `s` motion after an operator that reads the operator before it and a `surround.add`
  operator, through a new `engine` operation kind, and reads the pair from the keyboard ahead of
  the engine. The desktop's built-in plugin contributes `s` in operator-pending mode and visual
  `S`. The manual's Vim mode page and the settings reference describe it, in English and
  Brazilian Portuguese.
- 40f2f0b: TYTO-419 (ADR 0143 amendment): `@tyto/editor` ships three more vim operations for a
  contribution to map, with no keys mapped yet (the desktop's built-in plugin maps them in a
  later change). `replaceWithRegister` is a `gr` operator that replaces the text a motion covers
  with a register and leaves the registers as they were. `exchange` is an operator with two
  motions after an operator: `x` turns `c` into exchange (`cx{motion}` twice swaps two spans,
  `cxx` is a line) and `c` clears the marked span (`cxc`) while `cc` still changes the line.
  `unimpaired.blank` and `unimpaired.move` add blank lines above or below and move the line up
  or down by a count, in one undo step.
- f8052b8: TYTO-419 (ADR 0143 amendment): two more vim operations for a contribution to map, and a yank
  flash. `sneak` is a normal-mode action that reads two keys and jumps to the next occurrence of
  that pair in the buffer (`backward: true` for the previous one; a count picks the Nth; Escape
  cancels), and `sneak.repeat` repeats the most recent find, sneak or `f`/`t` (`reverse: true`
  for `,`). `vimMode()` now flashes the range a yank took for 200 ms; `setVimYankFlash(on)`
  switches it for every editor of the window, and `onVimYank(view, listener)` reports each yank's
  ranges, text and linewise.
- f75a2f6: TYTO-422 (ADR 0142): a vim contribution can map keys onto a text object. `defineVimOperation`
  takes a third kind, `{ kind: 'textObject', select(view, head, args, count) }`, which answers
  `{ from, to, linewise }` around the cursor and is registered as an engine motion, so `d`, `c`,
  `y`, visual mode, counts and `.` treat it as they treat `ip`. The editor ships two:
  `indentObject` (`ii`/`ai` in vim-indent-object's sense, a count climbing one level out) and
  `entireBuffer` (`ie`/`ae`). A text object mapped outside `visual` and `operatorPending`, and
  any mapping of `i` or `a` followed by two keys or more (`in(`), is refused with
  `E_VIM_CONTRIBUTION`, because vim's own `i` and `a` would always match first. No built-in plugin
  maps them yet (TYTO-419).
- cf54765: TYTO-442: vim's yank can share the system clipboard. `setVimSystemClipboard(port)` takes a `SystemClipboard` (`readText`, `writeText`) for every editor of the window: an unnamed yank (`yiw`, `yy`) is written to it, and when an editor takes focus a clipboard that changed since Tyto last wrote or read it goes into the unnamed register and `+`, so `p`, `.`, visual `p` and `gr` paste it. Named yanks do not write, and `"+y` stays the engine's own write. Off until a host passes a port. `VimYank` gains `register` (`unnamed`, `named` or `clipboard`).
- ed73f34: TYTO-96 (ADR 0075): the window gets one visual language, Zed's One Light and One Dark, in one token file. `@tyto/editor`'s palette is now a list of `var(--tyto-…)` custom properties the host defines instead of two sets of literal colours, exported as `themeTokens`; a host that defines none gets an uncoloured editor. Its selection colour now wins over CodeMirror's base rule while the editor is focused, and `restore` brings a stored tab up to the theme the editor is in now. The desktop defines every token in `src/renderer/tokens.css`, draws in the bundled Source Sans 3, follows the system's light or dark live in the window and in every editor, and fails `pnpm check` on a literal colour, radius, size or font anywhere else in the renderer.

### Patch Changes

- cbbf6df: TYTO-272: the completion list reads `--tyto-code-size` itself instead of inheriting the editor's size, so a host can give it a size of its own. With no host value set it is the size it was.
- cbbf6df: TYTO-272: a binding that ends in the minus key is shown with its minus. `bindingsOf` turned every `-` into the separator, so `Mod--` (Zoom out) read `Ctrl++` in the command bar and `Mod-Shift--` read `Ctrl+Shift++`; it now reads `Ctrl+-` and `Ctrl+Shift+-`, and `⌘-` on macOS.
- 20822f2: Vim's Escape reaches vim while a completion is still pending (TYTO-331). Typing wakes completion, and CodeMirror's completion keymap took Escape for a query nobody could see yet, so an Escape pressed right after a word left vim in insert mode. `vimMode()` now cancels such an unseen query and lets the key through; a completion popup that is on screen still closes on Escape and keeps the key, as before. Without vim nothing changes.
- e7ea146: Sticky scroll draws its rows again when the background parse finishes (TYTO-339). A template pasted and scrolled at once could leave the pinned rows missing until the next scroll: the parse that found the close tags landed in a transaction with nothing else in it, and the layer did not measure again.
- 41afd9c: TYTO-351: `relintBrief`, a state effect that makes `briefLint` lint the same text again. CodeMirror's linter reruns only on a change of text or configuration, so a host whose analysis learns something new about unchanged text had no way to redraw the underline; dispatching `relintBrief.of(null)` now does it.
- Updated dependencies [d4a6939]
- Updated dependencies [08b936d]
- Updated dependencies [7342c02]
- Updated dependencies [15997e9]
- Updated dependencies [93fcb8b]
- Updated dependencies [ea97dc3]
- Updated dependencies [c005b91]
- Updated dependencies [2495d0d]
- Updated dependencies [6abf89f]
- Updated dependencies [53e01c3]
- Updated dependencies [ae75027]
- Updated dependencies [3b261d1]
- Updated dependencies [74d7b28]
- Updated dependencies [fe85505]
- Updated dependencies [5a0c7c5]
- Updated dependencies [8e9c9c4]
- Updated dependencies [ab9512e]
- Updated dependencies [ab9512e]
- Updated dependencies [d3df40e]
- Updated dependencies [4aba89c]
- Updated dependencies [58f54d6]
- Updated dependencies [7a5f578]
- Updated dependencies [3355317]
- Updated dependencies [eb55249]
- Updated dependencies [a2b7fbd]
- Updated dependencies [532221f]
- Updated dependencies [5f98674]
- Updated dependencies [cfa70ff]
- Updated dependencies [bdab5da]
- Updated dependencies [eb0694a]
- Updated dependencies [dded20c]
- Updated dependencies [e4ce1e8]
- Updated dependencies [fdcfda9]
- Updated dependencies [4186112]
- Updated dependencies [3921252]
  - @tyto/core@0.29.0
  - @tyto/brief-lang@0.7.0
  - @tyto/template-lang@0.8.1

## 0.7.1

### Patch Changes

- e9984eb: A selection on the cursor's line shows again (TYTO-246). The active line's background is now
  translucent, composited to the same colour it had when opaque, so the selection that
  `drawSelection` paints behind the text shows through it — with the mouse, with vim's `V` and with
  vim's Ctrl+V. The gutter keeps the opaque colour.
- Updated dependencies [b20fe47]
- Updated dependencies [7dad141]
- Updated dependencies [4532332]
  - @tyto/core@0.28.0
  - @tyto/template-lang@0.8.0
  - @tyto/brief-lang@0.6.8

## 0.7.0

### Minor Changes

- 5c0611f: TYTO-49: plugin directives (ADR 0043). A plugin registers a `directive` contribution whose `id`
  is its namespace, with the `names` it answers and a `transform` that turns `::ns/name` into
  ordinary slot directives, which `resolve` checks against the manifest as if they were typed. The
  directive's adjustments are the plugin's arguments, handed over parsed and ranged, and the host
  stamps every range in the answer. `ResolveOptions.directives` and `JobPorts.directives` take the
  host's point through `directiveResolverOf`. The CLI wires it into every render, and an installed
  plugin's transform runs in its worker under the per-call deadline. The editor offers `ns/name`
  after `::`. Without the plugin the brief still gives `E_UNKNOWN_DIRECTIVE` on the name, and a
  plugin's refusal of its arguments is the new `E_DIRECTIVE_ARGUMENT`.
- 1ee0051: TYTO-44 — the desktop app has a template mode. _File ▸ Edit template…_ opens a markup template
  folder with `manifest.yaml` and `template.html` in tabs of their own, one of the folder's
  `examples/*.brief` as the sample, and every format the manifest declares drawn side by side
  from the unsaved buffers. Saving writes both files and reads the template folders again, and
  every open brief is compiled again; a manifest that does not parse is not written, and the
  diagnostic that stopped it is shown. A folder whose layout is a `template.ts` is refused with a
  sentence saying why (ADR 0007). _File ▸ New template…_ writes the same scaffold as
  `tyto template new`, into the template folder in force.

  The scaffold moved to `@tyto/template-lang` (`scaffoldTemplate`, `isTemplateName`) so both hosts
  write one text. It now also writes `examples/<name>.brief`, and its title uses "Source Sans 3"
  instead of "Inter": no install of Tyto has Inter, so every scaffolded template failed its first
  render with `E_EXPORT_FONT_UNRESOLVED`. `@tyto/editor` takes `language: 'plain'` for a buffer
  with no grammar.

  A quit that arrives while the window is still starting now quits (ADR 0039). The page tells main
  it can hear the quit question (`app:exit-listening`) before main asks it anything; before that,
  the push was dropped and the app stayed open with nobody left to ask.

### Patch Changes

- Updated dependencies [0937670]
- Updated dependencies [37fd201]
- Updated dependencies [7950dc3]
- Updated dependencies [8300c78]
- Updated dependencies [bf7c79a]
- Updated dependencies [8ca8eed]
- Updated dependencies [a84b756]
- Updated dependencies [a33a192]
- Updated dependencies [733f779]
- Updated dependencies [d4aac5b]
- Updated dependencies [94fdee3]
- Updated dependencies [eaf6ece]
- Updated dependencies [cd25d2d]
- Updated dependencies [5c0611f]
- Updated dependencies [82927c8]
- Updated dependencies [a69f493]
- Updated dependencies [64c75bb]
- Updated dependencies [091e2a2]
- Updated dependencies [e35546e]
- Updated dependencies [7659e7e]
- Updated dependencies [525639b]
- Updated dependencies [1ee0051]
  - @tyto/core@0.27.0
  - @tyto/template-lang@0.7.0
  - @tyto/brief-lang@0.6.7

## 0.6.7

### Patch Changes

- 1116f2d: Bump `@codemirror/state` to 6.7.6 and `@codemirror/view` to 6.43.13.

## 0.6.6

### Patch Changes

- Updated dependencies [17ad960]
  - @tyto/core@0.26.0
  - @tyto/template-lang@0.6.6
  - @tyto/brief-lang@0.6.6

## 0.6.5

### Patch Changes

- 56e1b6f: TYTO-183: Tab indents the line (or every selected line) by two spaces in the brief editor, and
  Shift+Tab takes them back. To move focus out of the editor with the keyboard, press Escape and then
  Tab.
- Updated dependencies [b587f0d]
  - @tyto/core@0.25.0
  - @tyto/brief-lang@0.6.5
  - @tyto/template-lang@0.6.5

## 0.6.4

### Patch Changes

- Updated dependencies [8b24969]
  - @tyto/core@0.24.0
  - @tyto/brief-lang@0.6.4
  - @tyto/template-lang@0.6.4

## 0.6.3

### Patch Changes

- Updated dependencies [80a03a8]
  - @tyto/core@0.23.0
  - @tyto/brief-lang@0.6.3
  - @tyto/template-lang@0.6.3

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
