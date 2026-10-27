# 0143 — Vim plugins are switched by an open setting and ship as a built-in

Status: accepted · 2026-10-26 · TYTO-418 · builds on ADR 0141, ADR 0142, ADR 0073 and ADR 0092

## Context

ADR 0141 gave plugins the `editor.vim` point and left two things to TYTO-418: wiring the window
to the registry, and the `vimPlugins` setting that decides which contributions are on. This card
also ships the first real contribution, vim-commentary, through the built-in plugin.

`@replit/codemirror-vim` 6.4.0 **already maps `gc`**: an operator, `toggleComment`, that runs
CodeMirror's `toggleLineComment`. So `gcc`, `gc{motion}` and visual `gc` work in a brief with no
plugin at all. What it does not do is a block comment: in a Markdown file or a template, whose
languages have only `<!-- -->`, vim's `gc` does nothing.

## Decision

1. **`vimPlugins` is an object of booleans with an open key.**
   `z.record(z.string().min(1), z.boolean())`, each member checked on its own (`members`, as
   `statusBarColors`), so a switch that is not a boolean is a warning at its value and only that
   plugin falls back. The key is not an enum, because an installed plugin's contribution is
   switched by its own id, which the settings tab cannot know in advance. The tab's `options`
   name the built-in ids (`commentary`, and `surround` before its contribution lands).

2. **Every vim plugin is on unless the setting says `false`**, built-in and installed alike
   (Rafael, 2026-10-26). The default is `{}` and the window resolves `value[id] ?? true`. The file
   replaces the object whole, as every object setting does, so a person writes only the ones they
   turn off. A plugin that should start off (sneak, TYTO-419) is the exception that will need its
   own rule; this ADR does not give it one.

3. **The built-in vim plugins are `editor.vim` contributions of the `desktop` built-in plugin**,
   registered with `registerVim` beside its settings and themes, and its manifest declares
   `"editor.vim"`. Their data lives in `apps/desktop/shared/vim-plugins.ts`, which both halves read.

4. **The window reads them on a new channel, `plugins:vim`.** Main answers the built-in host's
   `registry.vim()` followed by the installed plugins' (`windowPlugins().vim()`), after the
   plugins have started, as `plugins:keymaps` does. Built-ins first means that when an installed
   plugin maps the same keys in the same context, the window keeps the built-in's and refuses the
   second (ADR 0141 decision 3). The setting rides `theme:current` like `lineNumbers`, so a save
   switches a plugin in place; `setVimContributions` is diffed, so the many answers that change
   nothing change nothing in the engine. Refusals (`E_VIM_CONTRIBUTION`) go to the log, once per
   change.

5. **Commentary is a contribution on `gc` with no context, mapped onto a new `comment`
   operator** in `@tyto/editor` that runs CodeMirror's `toggleComment`, which reads the
   language's `commentTokens`: a line comment where the language has one, a block comment where it
   has only that. Being an operator, `gcc`, a count, any motion or text object, visual `gc` and
   `.` come from the engine. **Switched off, `gc` is vim's own again**, because unmapping our entry
   lets the dispatcher find the default (ADR 0141 decision 2). The measurable difference is a
   block-comment language: on, `gcc` wraps the line in `<!-- -->`; off, it does nothing. Wiring
   only the switch to vim's `gc` would have made "off" and "on" the same in a brief and both
   broken there.

   **In the window that language is Markdown**, a `.md` tab: a `template.html` opens in template
   mode, whose editor has no vim at all. And Markdown's `<!-- -->` never reached CodeMirror: the
   `Language` wrapping `@lezer/markdown` (ADR 0132) did not attach its facet to the tree's top
   node, where `toggleComment` looks, so it found no comment tokens. The parser now carries the
   facet as `languageDataProp` on `Document`. Measured in the window before the fix: `gcc` on a
   Markdown line changed nothing with commentary on.

6. **The adapter carries two more things from a contribution to the engine**, both for
   surround (TYTO-418 PR B):
   - an operation that declares `isEdit: true` has it passed on `mapCommand`'s extra, on the
     keymap entry, where the engine looks before it records the edit for `.`. An operator is
     recorded anyway; an action was not, which is the consequence of ADR 0141 this replaces;
   - `selectedCharacter`, the key a `<character>` in the mapping's keys stood for, is no longer
     filtered from the args, so `ys{motion}<character>` reaches the operation with the pair.

   And it clips an engine position to the document, as CodeMirror 5's were. A linewise operator
   that reaches the last line (`gcG`, visual `VG` then `gc`) is handed the start of the line
   after it, which the document does not have; unclipped, any contributed operator threw a
   `RangeError` there. Measured: three of the six commentary cases throw without the clip.

## Consequences

- A person who wants vim's `gc` with no block comments writes `"vimPlugins": { "commentary":
false }`. In a brief the two behave alike.
- An installed plugin's vim keys are on the moment it is installed, with nothing to write.
- A `surround` switch is documented before surround ships, so the key written today is the one
  that works when it lands; until then it switches nothing.
- The settings tab cannot suggest an installed plugin's id; it suggests the built-ins' only.
- Template mode's editor takes no vim, so `gc` in a template's markup is out of reach until it
  does; the editor's template language already answers `<!-- -->` to the operator.
- What the real window shows of `gcc` is measured once, by hand, in a `.md` and a `.brief` tab;
  jsdom covers the key sequences.

## Amendment — surround is a motion after an operator, and reads its pair from the keyboard (TYTO-418 PR B, 2026-10-26)

Surround ships as the `surround` contribution of the `desktop` built-in plugin, on by default as
decision 2 says. Two things above did not survive contact with the engine.

1. **`ys`, `cs` and `ds` cannot be mapped as keys.** `c`, `d` and `y` are whole operators in the
   engine's keymap, and its dispatcher takes a full match over a partial one, so after `y` the
   key buffer is cleared and `ys` is never seen. Each key after an operator is matched alone, in
   `operatorPending`. Surround is therefore **one motion, `s`, mapped in `operatorPending`
   onto `surround.target`, that reads the operator pending before it** (the engine hands a
   motion the input state it was typed in): under `d` it deletes the pair around the cursor,
   under `c` it changes it, and under `y` it puts the `surround.add` operator in the pending
   yank's place and returns nothing, so the motion typed next (`iw`, `$`, or `s` again for
   `yss`) feeds `surround.add` and the yank never runs. Visual `S` maps `surround.add`
   directly. Measured first in a throwaway jsdom test on 6.4.0: `ysiw"` on `hello world` gave
   `"hello" world`, with the motion seeing `yank` and the operator receiving `[0, 5]`.

2. **The pair is not a `<character>` in the keys.** Decision 6's second bullet assumed
   `ys{motion}<character>`; the engine accepts `<character>` only as the last key of a mapping,
   matched by prefix, so nothing can stand between `s` and it. The keys after surround's are
   read by `vim-key-reader.ts`, a keydown handler at `Prec.highest` ahead of `vim()`, which does
   nothing unless an operation is waiting on that view: one key for `ds` and `ys`, two for `cs`.
   A key with Ctrl or Meta, or Escape, cancels the read and goes on to vim.

3. **`.` repeats with the pair that was read.** The engine records the input state before the
   motion runs and replays it through the same args objects, so the keys are written onto the
   motion's args (`ds`, `cs`) or the operator's (`ys`, `S`) once read, and a replay finds them
   there and does not read again.

4. **A fourth operation kind, `engine`**, `{ kind: 'engine', type: 'motion' | 'operator',
define(engineName, nameOf) }`, for an operation whose contract with the engine the typed
   kinds cannot carry: it registers itself under the `tyto:` name it is given. Only the editor
   writes one; a plugin still only names it, and `setVimContributions` refuses an `engine`
   motion outside `visual` and `operatorPending` as it does a text object (ADR 0142 §3). This
   amends ADR 0142's "an operation never touches engine state" for this kind alone.

Pairs are `( ) b`, `[ ]`, `{ } B`, `< >` and three quotes: single, double and backtick. An
opening key adds a space inside when it wraps and takes the blanks just inside away when it is
the old pair of `ds` or `cs`; a closing key or its letter does neither. Quotes are found on the
cursor's line, paired from its start; brackets anywhere around the cursor, nesting counted.

Consequences:

- Switched off, nothing is waiting after `ds` and visual `S` is vim's own again; `s` after an
  operator was no command before.
- tpope's tag prompt (`ysiw<q>`), a key outside the pairs (`ysiw*`), and linewise `ys` putting
  the pair on lines of its own are not here: an unknown key does nothing, and `ysip)` wraps the
  paragraph inline.
- A key typed through an input method or a dead key (the backtick on an ABNT2 keyboard) reaches
  the reader as `Dead`, which it waits past; whether the character that follows arrives as a
  keydown is not measured.
- The status bar does not show the keys the reader takes as pending.
- What the real window does with these keys is not measured here; jsdom covers the sequences.

## Amendment — replace-with-register, exchange and part of unimpaired (TYTO-419, 2026-10-27)

Three more operations in `@tyto/editor`, each meant for its own id in `vimPlugins`. This
amendment records how they meet the engine (`@replit/codemirror-vim` 6.4.0) and why unimpaired
is only a part; the desktop's contributions, and so the ids and their defaults, come in a later
change of the same card.

1. **`gr` is an `engine` operator, `replaceWithRegister`, mapped with no context** (normal and
   visual, as commentary's `gc`). It needs the register the person named (`"agr{motion}`), which
   the typed `operator` kind filters out of the args it hands an operation. It reads the
   engine's register (`Vim.getRegisterController()`), dispatches the replacement and never
   writes a register, so `p` afterwards still pastes what was yanked. A linewise register over
   a charwise target drops its last line break; a charwise register over `grr` replaces the
   line's text and keeps its line break. The engine has no default `gr`, and a repeated
   multi-key operator is linewise (`grr`), so a count, visual `gr` and `.` come from the engine.
   `"+gr` reads the engine's `+` register, not the system clipboard.

2. **Exchange is an `engine` operator, `exchange`, and two `engine` motions mapped in
   `operatorPending`**, by the pattern of surround's `s`, because `c` is a whole operator and
   `cx` is never matched as two keys:
   - `x` (`exchange.target`): under `change` it puts the exchange operator in the cleared
     input state's place, carrying the count typed before `c`, and returns nothing, so the
     motion typed next feeds exchange and the change never runs; under the exchange operator
     it is the current line and the count after it, linewise (`cxx`); under any other operator
     it does nothing, as `x` after one did before.
   - `c` (`exchange.clear`): under the exchange operator it forgets the marked span (`cxc`).
     **Under `change` it is the line, linewise, as the engine's `expandToLine`**: the mapping
     shadows the engine's own doubling of `c`, so `cc` now runs this motion. Measured before
     shipping it, in a throwaway jsdom test turned into a suite case: `cc`, `3cc`, `c2c`, `cc`
     on an indented line, `cc` on the last line and `.` after `cc` leave the same text and
     cursor with exchange on as off. Under any other operator it does nothing, as `c` after
     one did before.
   - Visual `X` maps the operator directly, in place of the engine's delete-lines `X`, which
     comes back when exchange is off.

   The first span lives in a `StateField` the operator adds to its view the first time it runs
   there (`StateEffect.appendConfig`), mapped through every change until the second, and is
   marked with the `--tyto-selection` colour, a role every theme already sets. The second span
   swaps both in one transaction, so one `u` undoes it; when one span holds the other the outer
   is replaced by the inner, as vim-exchange does, and any other overlap cancels.

3. **Unimpaired is `[<Space>` / `]<Space>` and `[e` / `]e` in normal mode**, two actions
   marked `isEdit`, with an `up` arg for the bracket. A blank line is added above or below with
   the cursor left on its text; a line is moved by its count in one change, so one `u` undoes
   it. The engine's `[<character>` and `]<character>` motions lose only `e` and the space, which
   they had no meaning for; `[(` and the others are untouched. A keydown of `' '` reaches the
   engine as `<Space>`, measured in jsdom. The rest of unimpaired is not here: `[b`, `[f`, `[q`
   and `[o` drive buffers, files, the quickfix list and options, which a vim contribution
   cannot name (only text operations live in the editor); `[x` encodes markup, and the
   template editor has no vim; `[p` and `]p` are already the engine's.

Consequences:

- `c` in `operatorPending` belongs to exchange while it is on; a later change of the engine's
  `cc` would not reach a person with exchange on until the motion follows it.
- A count typed before `cx` reaches the motion after it: `2cxx` marks two lines.
- Visual `[e` / `]e` (moving a selection's lines) is not here.
- What the real window does with these keys is not measured here; jsdom covers the sequences.

## Amendment — sneak, the yank flash, and built-ins that start off (TYTO-419 A2, 2026-10-27)

Two more pieces in `@tyto/editor`, and the rule decision 2 left open. The desktop's table, ids
and defaults come in the card's last change (PR B), which implements the rule below.

1. **A built-in may default off.** The desktop's table of built-in vim plugins carries
   `defaultOn: false` for one that should start off, and the window resolves
   `value[id] ?? defaultOn ?? true`. Sneak is the first: on, it shadows vim's own `s` (`cl`)
   and `S` (`cc`), which a person who never asked for sneak would lose. An installed plugin
   cannot say so and stays on unless the setting says `false`, as decision 2 says.

2. **A `vimPlugins` id may switch an editor effect instead of a contribution**, for built-ins
   only. `highlightedYank` is one: a yank is not a key to map, so there is nothing for a
   contribution to carry, and the id switches `setVimYankFlash(on)`, which is per window like
   `setVimContributions`.

3. **A yank is inferred from public surfaces, never `cm.state.vim`.** The engine signals no
   yank and `y` is its own operator, which cannot be wrapped. It does signal
   `vim-command-done`, **before** a command's motion and operator run, so that signal opens a
   window that closes at the next one or at the end of the task. In it, the last selection that
   covered text is the range the operator was handed (the engine selects it before calling any
   operator), and a yank is a window that left the document unchanged while it changed the
   registers read through `Vim.getRegisterController()`: a new register `0` object, or new text
   or linewise in the unnamed register (`"ayiw` does not touch `0`). `dd`, `p`, `ysiw)` and
   `cxiw` are not yanks: the first two change the document, the last two change no register.
   Measured in a jsdom suite: `yiw`, `yy`, `3yy`, `y$`, `"ayiw`, `viwy`, `V2Gy` and `yii` each
   flash exactly the text yanked, a linewise yank without its last line break. The detector is
   its own piece, `onVimYank(view, listener)`, which reports the ranges, the text and linewise,
   so TYTO-442 can write the system clipboard from it. The flash marks the ranges for 200 ms in
   the `--tyto-selection` colour, as exchange's marked span; no new token.

4. **Sneak is two normal-mode actions**, `sneak` (`s`, and `S` with `backward`) and
   `sneak.repeat` (`;`, and `,` with `reverse`). `s` reads its two keys through
   `vim-key-reader.ts`, which works after an action as it does after a motion; Escape cancels.
   A count picks the Nth match, the match is case-sensitive, and nothing wraps. It is not an
   edit, so `.` still repeats the last change. Normal mappings never match while an operator
   is pending, so sneak's `s` does not meet surround's `s` in `operatorPending` or its visual
   `S`. Visual and operator-pending sneak are not here.

5. **`;` and `,` repeat the most recent find, sneak or `f`/`t`**, as vim-sneak does (Rafael,
   2026-10-27). Which came last is tracked per view from `vim-keypress` and `vim-command-done`,
   as `vimStatusPlugin` follows the engine: a command whose keys end in `f`, `F`, `t` or `T`
   and a character is a find, unless a `"` before the letter makes it a register name. **The
   `f`/`t` repeat is re-implemented** with the engine's arithmetic (the count, `,` reversing,
   and a `t` repeat starting one character on so it does not stay put next to the match),
   because the engine's last character search lives in its internals, and handing `;` back to
   it by unmapping and re-sending the key from inside a handler would re-enter its dispatcher.
   `d;` is still the engine's own `;`, which repeats `f`/`t` only.

Consequences:

- With sneak on, `;` and `,` in normal mode are sneak's; in visual mode and after an operator
  they are the engine's, which knows `f`/`t` only.
- The tracker and the engine each keep a last find; they agree in one view, and in two editors
  the engine's is shared while sneak's is per view.
- `"ayiw` twice on the same word changes no register the detector can see, so the second does
  not flash; the engine's register objects are read, not watched.
- `getRegister('0')` creates an empty register `0` when none exists, as the engine itself does.
- What the real window shows of the flash and of sneak is not measured here; jsdom covers the
  sequences, and `j` in visual line mode is not usable there (no layout).

## Amendment — vim's yank shares the system clipboard (TYTO-442, 2026-10-27)

The editor half of the card: `@tyto/editor` shares vim's unnamed register with the system
clipboard, as vim's `clipboard=unnamed` does. The desktop passes the clipboard in the card's
next change; until a host calls `setVimSystemClipboard(port)` nothing is read or written.

1. **The clipboard is a port.** `SystemClipboard` is `readText()` and `writeText(text)`, both
   promises, and `setVimSystemClipboard(port | undefined)` sets it for every editor of the
   window, as `setVimYankFlash` switches the flash. Undefined, the default, switches the
   sharing off and forgets the last text seen.

2. **Outward, only an unnamed yank writes.** `onVimYank` now says where a yank went
   (`register`): a new register `0` is `unnamed` (`yiw`, `yy`, and `"*yiw`, since `*` is no
   register to the engine and it treats the name as none), new text in `+` is `clipboard`,
   anything else is `named`. `"ayiw` does not write, as in vim with `clipboard=unnamed`, and
   `"+yiw` does not either: the engine writes `navigator.clipboard` itself on a `+` yank.
   `dd`, `x`, `ciw` and `p` are not yanks and write nothing. The register name cannot be read
   from the keys, because the engine reports a command done between `"` and `+`; it is read
   from the registers. Measured in a jsdom suite with a stub port.

3. **Inward, on editor focus, into `"` and `+`.** When the editor's content takes focus the
   clipboard is read and, if it changed, put in the unnamed register and `+`; register `0`
   is left alone. `p`, `P`, a count, `.`, visual `p`, `gr` and `grr` then paste it exactly as
   they paste the same text set in the register directly (one suite case each, compared with
   that). Reading on `p` instead was measured and dropped: the read is asynchronous, so the
   paste lost its count, and `gr`, an operator that runs at once, could not wait for it.

4. **"Changed" means it differs from the text Tyto last wrote or mirrored**, compared with
   `\r\n` normalised to `\n`, because Windows returns `\r\n` for text written with `\n`.
   Without that, Tyto's own `yy` came back at the next focus and overwrote a later `dd`; and
   without remembering a mirrored text, the same outside copy overwrote a later `dd` at every
   focus. An empty clipboard changes nothing. A read that a yank overtook (the read started,
   then a yank, then the read resolved) is remembered and dropped, so the yank stays. A port
   that rejects (an unfocused window rejects a read with `NotAllowedError`) or throws changes
   nothing.

5. **Linewise is "ends in a line break"**, as vim reads its `+` register: `L\n` copied outside
   pastes as a line under the cursor.

6. **The desktop will pass the renderer's `navigator.clipboard`.** Electron grants
   `clipboard-read` to the renderer when no permission handler is set, which is the case
   today. A future `session.setPermissionRequestHandler` must allow `clipboard-read` and
   `clipboard-sanitized-write`, or this sharing stops with no error (both calls reject, and
   rejections are dropped).

Consequences:

- A clipboard change made inside Tyto while the editor stays focused (a copy from another
  input in the same window, without the editor losing focus) arrives at the next focus, not
  at once.
- `"+gr` reads `+`, which holds the clipboard after a focus mirrored it; `"+p` is the engine's
  own and reads `navigator.clipboard` directly.
- The suite never touches a real clipboard: the port is a stub and so is `navigator.clipboard`
  for the engine's `"+y`. What the real window does is the desktop change's to measure.

## Amendment — the desktop's ids, and the clipboard it passes (TYTO-419 B / TYTO-442 desktop, 2026-10-27)

The desktop change the two amendments above left for later.

1. **The built-in table has ten ids.** Eight contributions of the `desktop` built-in plugin,
   `surround`, `commentary`, `replaceWithRegister` (`gr`), `exchange` (`x` and `c` in
   `operatorPending`, visual `X`), `unimpaired` (`[<Space>`, `]<Space>`, `[e`, `]e`),
   `indentObject` (`ii`, `ai`), `entireBuffer` (`ie`, `ae`) and `sneak` (`s`, `S`, `;`, `,` in
   normal mode), and two effects, `highlightedYank` and `systemClipboard`. ADR 0142 left the
   text objects' keys and switch to this card; their ids are the editor's operation names, and
   each key is mapped in `visual` and in `operatorPending`, the two contexts ADR 0142 decision
   3 allows. Only `sneak` says `defaultOn: false`.
2. **A new `settings.json` shows each id with its default**, `"sneak": false` among them,
   instead of every id `true`, so uncommenting the example changes nothing.
3. **The window passes one port object**, the renderer's `navigator.clipboard`, to
   `setVimSystemClipboard` on every settings answer while `systemClipboard` is on, and
   `undefined` when it is off; the same object again keeps the last text the editor saw. No
   preload, IPC or main-process change.

Consequences:

- `systemClipboard` and the new keys are not measured in the real window here; jsdom types the
  shipped mappings, and the clipboard is a stub in every test.
