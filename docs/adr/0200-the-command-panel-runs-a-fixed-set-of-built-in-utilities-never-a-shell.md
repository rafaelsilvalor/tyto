# 0200 — The command panel runs a fixed set of built-in utilities, never a shell

Status: accepted · 2026-11-15 · TYTO-535 · epic E20 · amends ADR 0159 decision 8 (the panel now
reads `&&`, `!N` and globs itself) and ADR 0164 decision 9 (the panel runs `tyto` and its own
built-ins) · builds on ADR 0111 and ADR 0113 · amended by ADR 0201 (file commands touch the
workspace folder, inside it only); note of 2026-11-15 (TYTO-536) on aliases and variables

## Context

The command panel runs `tyto` commands only (ADR 0159). `cli:run` takes words and hands them to
`commander`, so nothing reads `|`, `>`, `&&`, `$VAR` or a glob (decision 8), and the terminal ADR
kept that guarantee while putting a real shell next to it (ADR 0164 decision 9). The panel's only
command of its own was Clear, as a button and Ctrl+L.

The maintainer asked for the utilities a terminal has (TYTO-535): `clear`, `history` and `!N`,
`help`, `exit`, `last`, `&&` between commands, and `render *.brief`. Two more cards of the same
epic add more of them: file commands (`ls`, `cd`, `new`, `mv`, `rm`, TYTO-537) and aliases and
variables (TYTO-536). A refused command offering the window's own way (TYTO-726) reads the same
lines. So this decides where the panel's own commands live and what they may do, once.

## Decision

### 1. The panel runs `tyto` commands and a fixed set of built-ins, never a shell

A built-in is code in the renderer (`command-builtins.ts`). It starts no program, and no built-in
of this ADR writes a file (the file commands of ADR 0201 do, inside the workspace folder only). What a built-in runs, it runs as a `tyto` command through the same
port as a typed line (`cli:run`), so main's refusals (ADR 0159 decision 2) and the folder's trust
apply exactly as they would. `last` reruns a `tyto` command; `help <command>` runs
`<command> --help`. No new IPC channel: `cli:run` still takes words, and still never a line.

There is no way to run a program by name, and none is added by a built-in: the panel is not the
user-script tier ADR 0079 declined. The terminal (ADR 0164) is where a shell runs.

### 2. The panel reads the line; `cli:run` still takes words

The panel splits a line into steps on an `&&` outside quotes (`command-steps.ts`), with
`splitCommandLine`'s rules for words: spaces separate them, quotes keep one whole, a backslash is
a character. Then, in this order:

1. a step that is only `!N` becomes history entry N's steps, counted from 1 as `history` numbers
   them, once (the history keeps the expanded line, so an entry holds no `!` to follow);
2. each step's first word goes to the **built-in registry**; a quoted first word, and a step
   whose first word is `tyto`, never reach it;
3. a step no entry claims is a `tyto` command: its unquoted words with `*` or `?` are expanded
   (decision 4) and the words go to `cli:run`.

Steps run one after another and stop at the first that does not succeed: a `tyto` command that is
refused, stopped or ends with an exit code other than 0, or a built-in that fails. While a line's
steps run, the tab takes no other line, as while one command runs. `|`, `>`, `;`, `||` and `$VAR`
still mean nothing (ADR 0159 decision 8 holds for them).

**The seam for the next cards is step 2.** An alias (TYTO-536) is a lookup on the first word
before the registry, expanded once, its result read by the same parser; a variable is a word
replaced before step 3. A file command (TYTO-537) is a registry entry. Neither edits the parser.

### 3. A registry entry is a name, a help line, a restricted flag and a handler

Each entry says its name and aliases (`cls` for `clear`), the catalogue key of the line `help`
and completion show, whether it runs in a restricted folder (ADR 0111), and what it does through
a small context: the history, a way to run a `tyto` command in its session, clearing and closing
the session, and the CLI's first-level commands for `help`. It answers whether it printed lines
(a block of its own, ✓ 0 or ✗ 1), acted, or ended the session.

None of this card's built-ins writes, so all run in a restricted folder. An entry that writes
(TYTO-537's `new`, `mv`, `rm`) says it does not, and the panel refuses it there with a line that
names Workspace: Manage Trust. Built-ins are listed in completion as a first word, and after an
`&&`, beside the CLI's commands, and in `help`.

### 4. A glob is expanded by the panel, inside the workspace, through the explorer's listings

`*` matches any run of characters and `?` one, within one name: a glob never crosses a
separator, there is no `**`, and neither matches a name's leading dot unless the pattern's name
starts with one. A quoted word is never a glob. Every folder a pattern reads is listed by the
explorer's ids (`explorer:list`, ADR 0113), as completion lists them, so no path crosses to main
for it and a pattern reaches only what the explorer shows.

A pattern is refused, and nothing in its line runs, when it starts at a root (`/`, `C:\`,
`\\server`) or at `~`, has a `..` step, has no workspace folder to read, matches nothing (bash's
`failglob`: a command never receives `*.brief` as a file name), or matches more than 1,000
names. Matches are written relative to the working folder with the separator typed, in name
order.

### 5. One working folder per session

Globs, and the file commands to come, resolve against one value: the session's working folder,
as steps under the workspace root (`CommandSession.workingFolder`). It is the root today, and
`cd` (TYTO-537) changes only that value.

## Consequences

- The manual's Commands page says what the panel reads (`&&`, `!N`, `*`, `?`) and lists the
  built-ins; it no longer says `&&` and `*` reach a command as words.
- `history` numbers the lines this folder ran, the same list ↑ and Ctrl+R walk (TYTO-496).
- Stop on the running step stops the line: a stopped step does not succeed. Closing the panel
  does not: the element that runs the steps and the sessions it feeds outlive the dock removing
  it (read in the code, not measured in the window).

## Rejected

- **Running a shell for `&&` or a glob.** It would give the panel a shell's reach, which ADR
  0164 put in a separate surface on purpose.
- **Expanding globs in main.** Main has the folder, but a pattern would then be a path crossing
  from the renderer (ADR 0113), and the trust and confinement checks would be a second copy of
  the explorer's.
- **Passing a pattern that matches nothing as a literal word**, as a default bash does. The
  command then fails with a file it cannot find, far from the pattern that caused it.
- **A `templates` built-in listing the window's templates.** The card asked for one. The CLI has
  no command that lists the templates in reach, and the panel does not reimplement one in the
  renderer: a `tyto` command that does would make it a one-line entry. TYTO-728 adds both.

## Note, 2026-11-15 — aliases and variables (TYTO-536)

TYTO-536 fills the seam of decision 2 as it said: an alias is a lookup on the first word before
the registry, and a variable is part of a word read before step 3. The parser is unchanged but
for one record: where in a word a `$` was typed outside single quotes.

**An alias expands once.** After `!N`, a step whose unquoted first word names an alias (and is
not `tyto`) becomes the alias's line, read by the same parser, with the step's other words after
its last step. The words it brings are taken literally: never looked up as an alias again, and no
`$` in them is read, so an alias means the same whatever the session has set. An alias can take
no name the registry answers to, nor `tyto`: one written in a file with such a name is ignored,
and the panel says so once. The person's aliases (`commandAliases` in `settings.json`) and the
workspace's (`aliases` in `.tyto/project.json`, ADR 0112 note of 2026-11-15) are merged by main,
the workspace's winning by name; a restricted folder's never reach the window, so none runs.

**An alias never turns into something a refusal would not see.** What it expands to goes through
the registry and `cli:run` exactly as typed words do, so a built-in's restricted check, main's
refusals and their offers (TYTO-726) all apply. `cli:run` gains an optional `origin` — the alias
and where it is defined — which the refusal's sentence and its box name; it is a label only, and
main decides on `argv` alone.

**`$VAR` now means a session variable**, amending decision 2's last sentence. `set name=value`
sets one for the panel's session (one tab), and `$name` reads it:

- only what `set` gave this session, never the environment's variables; a name never set refuses
  the line and nothing in it runs, as a pattern matching nothing does (decision 4);
- inside a word, unquoted or in double quotes; never in single quotes;
- replaced after the line is read, so a value is always one word: its spaces, quotes or `&&` are
  characters of that word, never a new word or a new step. A word a variable made counts as
  quoted: never a glob, never a built-in's name.

`|`, `>`, `;` and `||` still mean nothing. The history keeps the line as typed, alias names and
`$name` included.

`alias`, `unalias` and `set` are registry entries that run in a restricted folder: they write the
person's own settings (`commands:set-alias`, main checking the name and line again) or this
session, never the folder.
