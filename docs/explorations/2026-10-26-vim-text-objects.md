# Can the vim engine take new text objects?

Status: **exploration, not binding** · 2026-10-26 · hosted by TYTO-420 · see
`docs/explorations/README.md`

Batch `vim-plugins` wants indent-object (`ii`, `ai`) and targets-style objects (`a,`, `in(`).
The card held a belief, unmeasured: `@replit/codemirror-vim` 6.4.0 has no public way to add a
text object, because its objects are a fixed switch inside the engine. This note measures it.

**Answer: the belief is half true, and the false half is the useful one.** There is no
text-object API, but a text object in this engine _is_ a motion, and `Vim.defineMotion` is
public. A motion that returns a `[start, end]` pair, mapped in `visual` and `operatorPending`,
behaved exactly like a built-in object for `vii`, `dii`, `cii`, `yii`, counts and `.` in every
case run below. One thing does not work, and no Tyto-side workaround fixes it: **a three-key
object that starts with `i` or `a` followed by a letter (`in(`, `il(`, `an"`) cannot be
reached**, because the engine's built-in `i<register>` / `a<register>` entry fully matches the
first two keys and wins.

## What was measured, and how

Engine: `@replit/codemirror-vim` 6.4.0, which bundles `@replit/codemirror-vim-core` 0.1.0
(`vim.js`). The code was read from the installed package. The behaviour was run in a throwaway
Vitest file in `packages/editor` (deleted, not committed) that drives a real `EditorView` in
vim mode with `Vim.handleKey(getCM(view), key)`, the way `vim-contributions.test.ts` does.

Two things about the instrument, before the results:

- **jsdom was loaded by hand in a `beforeAll`**, not by the `// @vitest-environment jsdom`
  line. On this machine, under load from other sessions, the jsdom worker took longer than
  Vitest's 60 s worker-start limit (`Timeout waiting for worker to respond`, three runs out of
  three, including the committed `vim-contributions.test.ts`). The node environment plus a
  hand-made `JSDOM` and a 300 s hook timeout got past it. Nothing in the results depends on
  that choice.
- **`j` is useless in jsdom after a linewise delete.** It jumped to the last line of the
  document for the built-in `dip` as well as for the new object, because the engine's vertical
  motion asks CodeMirror for screen coordinates and jsdom has no layout. A first run of
  `dii j .` therefore deleted the whole document, which looked like a broken repeat and was
  not. The dot-repeat cases below place the cursor with a dispatch instead of `j`.

`handleKey` in insert mode does not insert characters, so typed text in the `cii` cases is a
dispatch too.

The sample, cursor on `text d` (line 4, column 6):

```
scene a
  frame b
    text c
    text d

    text e
  frame f
    text g
scene h
```

The motion: the block of lines around the cursor whose indent is at least the cursor line's,
blank lines inside it included and blank lines at its edges trimmed; each extra count goes one
indent level out (the vim-indent-object rule). It is linewise the same way the built-in `ip` is:
it sets `motionArgs.linewise`, sets `vim.visualLine` in visual mode and
`inputState.operatorArgs.linewise` otherwise. Mapped as
`Vim.mapCommand('ii', 'motion', name, {}, { context })` for `visual` and for `operatorPending`.

## 1. Does 6.4.0, or anything newer, expose a way to add a text object?

**No.** The built-in objects are two keymap entries and one motion:

```js
// vim.js (codemirror-vim-core 0.1.0), defaultKeymap
{ keys: 'a<register>', type: 'motion', motion: 'textObjectManipulation' },
{ keys: 'i<register>', type: 'motion', motion: 'textObjectManipulation', motionArgs: { textObjectInner: true }},
```

`motions.textObjectManipulation` is an `if` chain over `motionArgs.selectedCharacter`: the
bracket pairs, `b`, `B`, the quotes, `w`, `W`, `p`, `t` and `s`. Anything else returns `null`
("No valid text object, don't move"). The chain is a closed function; nothing outside it can
add a branch. The exported `vimApi` has `defineMotion`, `defineAction`, `defineOperator`,
`mapCommand`, `_mapCommand`, `defineRegister`, `defineEx`, `map`/`unmap` and the modes, and no
`defineTextObject`.

Newer releases: none. `npm view @replit/codemirror-vim versions` ends at `6.4.0`
(2026-07-29), and `@replit/codemirror-vim-core` has only `0.1.0`. Upstream `main` has not
touched `packages/codemirror-vim-core/vim.js` since the move to a monorepo (`263bfbb`,
2026-07-28, #271), and a code search for `defineTextObject` in the repository returns 0 hits.

**But a text object is already a motion.** `evalInput` treats an array returned by any motion
as `[anchor, head]`, and the public type says so:

```ts
// @replit/codemirror-vim dist/index.d.ts
defineMotion: (name: string, fn: MotionFn) => void;
// codemirror-vim-core dist/types.d.ts
export type MotionFn = (cm, head, motionArgs, vim, inputState) => Pos | [Pos, Pos] | null | undefined;
```

The motion receives `vim` (so it can set `visualLine`), `motionArgs.repeat` (the count) and
`motionArgs.selectedCharacter` (for a `<character>` key). That is everything the built-in
objects use.

## 2. Does `defineMotion` plus a map give `vii`, `dii`, `cii` the same result?

**Yes, in every case run.** Each block is the throwaway's output for one key sequence: how
many times the motion ran, the mode after, the selection, and the document.

```
### vii: keys "vii"
motion calls: 1
mode: visual=true visualLine=true insert=false
selection: "    text c\n    text d\n\n    text e", cursor line 6
### dii: keys "dii"
motion calls: 1
doc: "scene a\n  frame b\n  frame f\n    text g\nscene h"
### cii: keys "cii"
motion calls: 1
mode: visual=false visualLine=false insert=true
doc: "scene a\n  frame b\n    \n  frame f\n    text g\nscene h"
### cii X Esc: keys "ciiTYPE:X<Esc>"
doc: "scene a\n  frame b\n    X\n  frame f\n    text g\nscene h"
### d2ii: keys "d2ii"
doc: "scene a\nscene h"
### 2dii: keys "2dii"
doc: "scene a\nscene h"
### v2ii: keys "v2ii"
mode: visual=true visualLine=true insert=false
selection: "  frame b\n    text c\n    text d\n\n    text e\n  frame f\n    text g", cursor line 8
### dii LINE:4 .: keys "diiLINE:4."
motion calls: 2
doc: "scene a\n  frame b\n  frame f\nscene h"
### cii X <Esc> j .: keys "ciiTYPE:X<Esc>LINE:5."
motion calls: 2
doc: "scene a\n  frame b\n    X\n  frame f\n    X\nscene h"
### vii d LINE:4 .: keys "viidLINE:4."
motion calls: 1
doc: "scene a\n  frame b\n  frame f\n"
### yii P: keys "yiiP"
doc: "scene a\n  frame b\n    text c\n    text c\n    text d\n\n    text e\n    text d\n\n    text e\n  frame f\n    text g\nscene h"
```

What each line shows:

| Case                     | Result                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vii`                    | Linewise visual over `text c`…`text e`, inner blank line kept                                                                                                                                                                                     |
| `dii`                    | The four lines gone, linewise, cursor on the next line                                                                                                                                                                                            |
| `cii`                    | One empty line kept at the block's indent, insert mode, as linewise `cc` leaves it                                                                                                                                                                |
| Count (`d2ii`, `2dii`)   | Both spellings reach the motion as `repeat 2` and delete one level out (`frame b`…`text g`); `v2ii` selects the same                                                                                                                              |
| `.` after `dii` / `cii`  | **Works**: the motion runs again from the new cursor and deletes or changes only `text g`'s block                                                                                                                                                 |
| `.` after `vii` then `d` | Repeats "the same number of lines" (4, clipped to the 2 left), and the motion is not called again. That is vim's own rule for a visual-mode operator, and the engine applies it to every visual operation, built-in or not                        |
| `yii` then `P`           | Correct text, but the cursor stays where it was, so `P` pastes above `text d`. The built-in `yip` does the same (its run is in the same file): the engine's `yank` returns `oldAnchor` outside visual mode. An engine trait, not a motion problem |

Built-ins checked in the same run, with the map in force: `i` alone still enters insert mode,
`diw` still deletes `text`, `vip` still selects the paragraph. Mapping `ii` shadows exactly the
keys `ii`, not the other `i…` objects: user maps are unshifted ahead of the defaults
(`_mapCommand`), and the dispatcher takes the first full match (`matchCommand`:
`bestMatch = matches.full[0]`).

**What does not work: `in(`.** Two more mappings in the same file, `in<character>` and `a,`,
both on a motion that logs its call:

```
### din(: keys "din("
motion calls: 0
selection: "", cursor line 1
### da,: keys "da,"
motion calls: 1
```

`da,` reached the motion. `din(` never did: after `in`, `i<register>` is a **full** match (it
accepts any one character) while `in<character>` is only a partial one, and `matchCommand`
prefers any full match. The built-in object ran with `n`, found nothing, and `(` then ran as the
sentence-back motion (the cursor ended on line 1). Mapping the literal `in(` changes nothing;
the full match on `in` comes first. So every targets object of the form `i`/`a` + letter +
character (`in(`, `il(`, `an"`, `Ina`) is out of reach on 6.4.0, while two-key ones (`a,`, `i,`,
`ia` for an argument, `ii`, `ai`, `ie` for the entire buffer) are fine.

## 3. Is there an upstream issue or PR, and would a small one be accepted?

**There is none.** Searches of `replit/codemirror-vim` issues and PRs for "text object",
"textobject", "custom text object", "defineTextObject", "defineMotion", "indent object" and
"targets" returned nothing about adding objects. The nearest is open PR #278 (2026-10-03,
"Fix da}/da) text objects picking the wrong block…"), a fix inside the existing switch.

**Acceptance would be slow, by the record.** The last 25 merged PRs: the maintainers
(nightwing, masad-frost) merge in batches (five on 2026-02-21, five on 2026-07-28/29), and the
outside contributions merged since 2024 are few (#179 in 2024-11, #207 and #236 in 2025). Ten
PRs are open, the oldest from 2025-05-20 (#233), and an outside motion PR of the same size as
ours, #262 (`g_`, opened 2026-03-29), has waited seven months. A PR would probably be welcome
but should be planned as months, not days, and Tyto would keep a patch until a release.

## 4. Recommendation

**Motion workaround, now, for the two-key objects; no upstream PR and no fork.**

| Path                                                                                 | Cost                                                                                                                                         | Gets                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Motion workaround** (recommended)                                                  | Size S–M: a third operation kind in `vim-contributions.ts`, one operation per object, tests in the existing jsdom file. No dependency change | `ii`, `ai`, `a,`, `i,`, `ie`, `ae`, with counts and `.`            |
| Upstream PR (a text-object registry, or prefer a longer user map over `i<register>`) | Size M of work plus months of waiting (see 3), and a `pnpm patch` of a bundled `dist` file while it waits                                    | Only the extra is `in(` / `il(`: the three-key targets forms       |
| Fork                                                                                 | Ongoing: every upstream release re-merged into a 7 164-line file                                                                             | Nothing the two above do not                                       |
| Not worth it                                                                         | 0                                                                                                                                            | Nothing; `ii` is the object the card calls most useful for a brief |

### How a text object fits ADR 0141

ADR 0141 lets a plugin map keys onto an operation **named** in `@tyto/editor`, of kind
`'action'` or `'operator'`. A text object is a third kind, and it maps onto the engine's
`'motion'` type the way the other two map onto theirs:

```ts
| {
    readonly kind: 'textObject';
    /** The range around `head`, or nothing; `inner` is `i` versus `a`, `count` is the repeat. */
    select(view: EditorView, head: number, args: VimOperationArgs & { count: number }):
      { from: number; to: number; linewise: boolean } | undefined;
  }
```

- `defineVimOperation` registers it with `Vim.defineMotion(engineName(name), …)`, converts
  offsets to `{ line, ch }`, and does the linewise bookkeeping the measured motion did
  (`motionArgs.linewise`, `vim.visualLine`, `operatorArgs.linewise`), so an operation never
  touches engine state.
- `apply` already calls `Vim.mapCommand(keys, operation.kind, …)`; for this kind the engine type
  is `'motion'`, so the kind name and the engine type part ways here (or the kind is simply
  called `'motion'`, which also admits plain motions later).
- `problemOf` refuses a text object in `normal` or `insert` (in normal mode `ii` would be a
  cursor jump, and `i` alone, a full match, makes it unreachable anyway). A contribution maps it
  in both `visual` and `operatorPending`; the alternative, an absent context expanding to those
  two, saves the plugin a line but hides what is mapped.
- `problemOf` also refuses keys of the form `i`/`a` + letter + more, with the reason from
  question 2, so a plugin learns at registration why `in(` cannot work instead of finding a
  silent no-op.
- `args.inner` is the plugin's own (`{ inner: true }` on `ii`, absent on `ai`), as surround's
  args are.

### The follow-up card, described (not created)

**"Add a text-object operation kind to the vim contribution point, and indent objects"**
(editor, batch `vim-plugins`, size M). Scope: the `textObject` kind in `vim-contributions.ts`
and its registration through `Vim.defineMotion`; `problemOf` rules for contexts and for the
unreachable three-key form; the operations `indentObject` (`ii`, `ai`, counts going outward)
and, if the batch wants it, `entireBuffer` (`ie`, `ae`); the built-in plugin's contribution
switchable from `settings.json`; tests in `vim-contributions.test.ts` for `vii`, `dii`, `cii`,
a count and `.`; an ADR amending 0141 for the new kind. Out of scope: `in(` and the other
three-key targets forms, which wait for an upstream change. A separate, later card can add the
argument object (`a,`, `i,`), which needs a small parser for comma lists in a brief.

## Left open

| What                                                                    | Why it matters                                                                               | State                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Three-key targets objects (`in(`, `il(`)                                | Out of reach on 6.4.0 without an upstream change to `matchCommand` or a text-object registry | Measured; no card                           |
| `yii` leaves the cursor in place                                        | Differs from real vim; same for the built-in `yip`, so it is the engine's                    | Measured; not Tyto's to fix                 |
| Behaviour in the real window (`j`, rendering of the linewise selection) | jsdom has no layout, so `j` was replaced by a dispatch and nothing was looked at             | Not measured; belongs to the follow-up card |
| Jsdom worker missing Vitest's 60 s start limit on this machine          | Affected the committed `vim-contributions.test.ts` too, under load from other sessions       | Seen 3 of 3 times here; not investigated    |
