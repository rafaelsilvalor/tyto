# 0159 — The command panel runs `tyto` commands inside the window, in main, through a shared package

Status: accepted · 2026-10-30 · TYTO-494 · epic E20 (TYTO-493) · builds on ADR 0010, ADR 0011,
ADR 0029, ADR 0044, ADR 0050, ADR 0067, ADR 0079, ADR 0111, ADR 0113, ADR 0151 and ADR 0157

## Context

On 2026-10-30 the maintainer asked for the CLI inside the app: a command panel first and a full
terminal later, "as complete as possible in what it can do and in usability". The panel is
TYTO-495 (the runner in main) and TYTO-496 (the panel). The terminal is TYTO-497. This ADR
decides how a command runs, what it may reach, how it asks and stops, and what crosses into the
renderer. It is written before either card so that neither one has to make these decisions
alone.

**What exists at `origin/main` 6b7e5b8c, read in the code.**

- The CLI builds its command tree around an injected environment and never around `process`:
  `createProgram(environment, captured)` and `run(argv, environment)` in
  `apps/cli/src/program.ts`, `CliEnvironment` in `apps/cli/src/environment.ts` (console, version,
  cwd, a `rasterizer()` factory, `home`, an optional `confirm`, `variables`). Every handler
  returns an exit code. `run` turns a refused command line into 1 and an escaped throw into 2.
- **`createProgram` cannot run in Electron's main as it stands, for two reasons.**
  1. The CLI starts an installed plugin with `fork` (`apps/cli/src/plugins/plugin-process.ts`).
     Electron replaces `fork` with one that throws while the RunAsNode fuse is off, and the
     packaged app has it off (ADR 0067). The launcher can already be injected
     (`launch` in `apps/cli/src/plugins/external.ts`), but no command passes one in from the
     environment.
  2. The CLI rasters through Playwright (`defaultRasterizer`). The desktop ships no Playwright
     and no Playwright browser. It rasters through a hidden window of its own (ADR 0002,
     ADR 0027, `apps/desktop/src/main/rasterizer.ts`).
- **The two apps cannot import each other** (`apps/desktop/src/main/plugin-process.ts`). Composition
  happens in `apps/*` only, and the CLI is one app.
- The window already does three things the CLI does, through the same library code: an export
  (`export.ts`, `runJob` from `@tyto/pipeline`), the plugin-files sync (`plugin-files.ts`,
  `@tyto/io`'s sync, with a native approval box) and a new delivery (`delivery.ts`,
  `planDelivery` and `createDelivery`, ADR 0157). The window reads the same `trust.json`
  (`fsTrustStore` in `apps/desktop/src/main/index.ts`).
- **The preview and the export compile in main**, on main's own thread (`preview.ts` calls
  `compile`, and `export.ts` calls `runJob`). Only the raster capture leaves main, to the hidden
  window. A command that compiles in main does what the window already does.
- `tyto watch` takes an `AbortSignal` (`watch.ts`), and so does a render task
  (`render-task.ts`, passed to `runJob`). `program.ts` passes neither, so today a command run
  through `run` cannot be stopped.
- `tyto plugin install <npm spec>` runs `npm pack`. On Windows that goes through a shell, because
  `npm` is `npm.cmd` there (`apps/cli/src/plugins/fetch.ts`, `runNpm`). It is the only place in
  the CLI that starts a shell.
- An exception that escapes into main's `uncaughtException` handler opens the crash box
  (`installCrashHandlers`, `apps/desktop/src/main/index.ts`).

### What each option costs, measured

Measured on 2026-10-30 on Windows 11 with the app's bundled Node 24.21.0
(`apps/desktop/out/node/node.exe`). Everything ran in a scratch worktree at
`C:\projects\tyto\s494` (detached at `origin/main` 6b7e5b8c), which was deleted afterwards.
Nothing from the experiment is in this repository. The two probe scripts and the `esbuild`
commands that bundled them are in TYTO-494's pull request description. Each command below ran
in the scratch copy's `apps/cli`.

**Bundle size.** One line was added to `src/main/index.ts` in the scratch copy, which imported
`createProgram` from `apps/cli/src/program.ts` and kept a reference to it. Then main was built
with the app's own config (`npx electron-vite build` in `apps/desktop`), before and after the
change. `du -sb out/main` counts `index.js` and its chunks:

| `out/main`             |     Bytes |
| ---------------------- | --------: |
| `origin/main`          | 3,961,269 |
| plus `createProgram`   | 4,179,923 |
| **Difference: +5.5 %** |   218,654 |

The bundle had no Playwright in it afterwards: `defaultRasterizer` is reached only from
`defaultEnvironment()`, which `program.ts` does not import. The CLI's other dependencies are
mostly already in main (`core`, `io`, `pipeline`, the exporters). What the change added is
mainly the command tree and `commander`.

A child process would need the CLI as one self-contained file beside the bundled Node, built
like the plugin bootstrap (ADR 0050). `esbuild src/index.ts --bundle --platform=node
--format=esm` in `apps/cli` (Playwright and `@tyto/fonts` external) gives **4,154,013 bytes**.
That file would also need a rasterizer. It could be Playwright (the `playwright-core` folder
here is 13 MB, and its headless shell 272 MB), or a bridge that sends every capture back to
main's hidden window over the IPC slot.

**Startup.** Ten `spawnSync` runs each on the bundled Node, median (min–max):

```
$ ../desktop/out/node/node.exe /c/projects/tyto/s494-probe/spawn-time.mjs "$(cygpath -w ../desktop/out/node/node.exe)" probe/cli-self.mjs
  node -e 0: exit=0 out=""
node -e 0	min=126ms	median=136ms	max=153ms
  tyto --version: exit=0 out="0.8.1\n"
tyto --version	min=297ms	median=334ms	max=362ms
  tyto template check (missing): exit=1 out="error E_INPUT_READ Could not read 'nope\\manifest.yaml': ENOENT: no such file or "
tyto template check (missing)	min=300ms	median=392ms	max=428ms
```

In-process, `run(['--version'], environment)` took 0 to 1 ms on each of three calls (`--version#1..3` below).

**What a render does to the event loop.** This is the deciding number. A timer that should fire
every 5 ms recorded how late each tick was while `run(['render', …, '--types', 'svg'])` ran
in the same process. That is the lag the window would feel if the command ran in main. The
threshold was set at **100 ms** before measuring, because past that a keystroke in the editor
visibly stalls. Two briefs were used: the CLI's `cartaz` fixture (one format, two slides) and
the built-in `carrossel-lista` example (two formats, four slides, measured text):

```
$ for i in 1 2 3; do ../desktop/out/node/node.exe probe/probe-lag.mjs list-first | head -2; done
carrossel-lista#cold	exit=0	wall=230ms	worst-lag=137ms	ticks=12	ticks>100ms=1
files grid-1x1-01.svg grid-1x1-02.svg grid-1x1-03.svg grid-1x1-04.svg result.json story-01.svg story-02.svg story-03.svg story-04.svg
carrossel-lista#cold	exit=0	wall=246ms	worst-lag=153ms	ticks=11	ticks>100ms=1
files grid-1x1-01.svg grid-1x1-02.svg grid-1x1-03.svg grid-1x1-04.svg result.json story-01.svg story-02.svg story-03.svg story-04.svg
carrossel-lista#cold	exit=0	wall=255ms	worst-lag=148ms	ticks=14	ticks>100ms=1
files grid-1x1-01.svg grid-1x1-02.svg grid-1x1-03.svg grid-1x1-04.svg result.json story-01.svg story-02.svg story-03.svg story-04.svg

$ ../desktop/out/node/node.exe probe/probe-lag.mjs
cartaz#1	exit=0	wall=127ms	worst-lag=14ms	ticks=14	ticks>100ms=0
cartaz#2	exit=0	wall=35ms	worst-lag=2ms	ticks=6	ticks>100ms=0
cartaz#3	exit=0	wall=34ms	worst-lag=1ms	ticks=6	ticks>100ms=0
cartaz#4	exit=0	wall=29ms	worst-lag=1ms	ticks=5	ticks>100ms=0
cartaz#5	exit=0	wall=27ms	worst-lag=1ms	ticks=5	ticks>100ms=0
carrossel-lista#1	exit=0	wall=161ms	worst-lag=115ms	ticks=8	ticks>100ms=1
carrossel-lista#2	exit=0	wall=56ms	worst-lag=8ms	ticks=8	ticks>100ms=0
carrossel-lista#3	exit=0	wall=54ms	worst-lag=8ms	ticks=8	ticks>100ms=0
carrossel-lista#4	exit=0	wall=49ms	worst-lag=7ms	ticks=8	ticks>100ms=0
carrossel-lista#5	exit=0	wall=51ms	worst-lag=9ms	ticks=7	ticks>100ms=0
--version#1	exit=0	wall=1ms	worst-lag=0ms	ticks=0	ticks>100ms=0
--version#2	exit=0	wall=0ms	worst-lag=0ms	ticks=0	ticks>100ms=0
--version#3	exit=0	wall=0ms	worst-lag=0ms	ticks=0	ticks>100ms=0
```

The second run is one process, in that order, so `carrossel-lista#1` there follows five warm
`cartaz` renders. The three `list-first` runs are three processes, each rendering
`carrossel-lista` cold first. The `| head -2` closed the pipe after two lines, and the
process's next write died with `EPIPE`. That is the pipe, not the render: each run had already
printed exit 0 and its eight files.

**The first render of a template in a process holds the event loop for 115 to 153 ms, which is
over the threshold.** Later renders of the same template stay under 10 ms. In these runs the cold cost came with the
first render of each template, and the first `cartaz` stayed at 14 ms. Which cache makes the
later renders fast was not identified, so "once per template per session" is what was seen, not
a rule. The panel does not cause this cost.
The window's own preview and export pay the same first-compile cost, on the same thread, today.
That cost was not measured in Electron (Consequences).

A child process does not avoid the cold cost. It pays it on every command, because a new process
always starts cold, and it adds about 334 ms of startup before the command begins.

**Crash isolation, read in the code and not provoked.** In-process, `run` turns any throw that a
command awaits into exit 2 and a line on the error stream, and the app keeps running. Three
things are not contained:

- a throw outside any awaited chain, which reaches `uncaughtException` and the crash box;
- a loop that never yields, which freezes the window;
- memory that is never freed, which grows main.

A child process contains all three, because it can be killed. The price is that it cannot share
anything with the window. It has no access to the hidden-window rasterizer, the running plugin
host, the trust state already loaded or the approval box. All of those would have to be rebuilt
in the child or carried over IPC.

## Decision

### 1. A command runs in main, in-process, through a package both apps compose

**The panel runs a command by calling the CLI's `run` in main, with an environment the desktop
builds.** It does not start a child process. The numbers above are the reasons:

- in-process adds 218,654 bytes to main;
- a child process would add 4 MB of CLI plus either a Playwright browser or a raster bridge;
- a child process starts in 334 ms and is cold on every command, while in-process starts in
  under 1 ms and is warm after the first command;
- the in-process lag is the same lag the window already accepts for its own preview.

**The command tree moves out of `apps/cli` into a package** (working name
`@tyto/command-line`). The rule is that neither app imports the other, and that rule stands.
`apps/cli` keeps `index.ts` and `defaultEnvironment()`. The desktop gets an environment of its
own. The package may use Node, as `@tyto/io` does. It is not one of the pure packages that
`CLAUDE.md` lists. **The move belongs to TYTO-495 and not to this card.** It lands after
task-folders' TYTO-490 PR A and PR B, which both touch `program.ts` and `render*`. A new package
trips two repo-checks: the labeler, and the list of packages. TYTO-495 updates both.

`CliEnvironment` gains what a window must supply and a terminal never had to. Each item is a
port, and `defaultEnvironment()` fills it with what the CLI does today:

| Port                   | Terminal (`apps/cli`)         | Window (`apps/desktop`)                                                          |
| ---------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `console`              | `process.stdout` / `stderr`   | streamed to the panel (decision 5)                                               |
| `rasterizer()`         | Playwright                    | the window's own hidden-window rasterizer, the instance the export uses          |
| plugin launcher (new)  | `fork` on the running Node    | `bundledNodeLauncher`: `spawn` with an `ipc` slot on the bundled Node (ADR 0067) |
| `confirm`              | a `[y/N]` line on a TTY       | a native box from main (decision 4)                                              |
| `cwd`                  | `process.cwd()`               | the open workspace folder (ADR 0113); with none open, `TYTO_HOME`                |
| `home`, `variables`    | `TYTO_HOME`, `process.env`    | the same `TYTO_HOME` the window reads, and the window's environment              |
| signal (new)           | none; Ctrl+C ends the process | the panel's Stop (decision 6)                                                    |
| diagnostics sink (new) | none (printed text only)      | the Problems panel (decision 7)                                                  |

`run(argv, environment, signal?)` threads the signal into every command that can honour it.
Today that means `watch` and the render task's `runJob`.

**When the lag matters, the fix goes where the cost is.** The cold cost is in compiling, and the
preview pays it too. If it becomes worth removing, the compile for the window and for the panel
moves off main's thread together, through one decision of its own. It would not move into a
child process for the panel alone, which would still pay the cost on every command.

### 2. Every subcommand is reachable, with exclusions that each give a reason

**The panel accepts every `tyto` subcommand by default, `watch` included.** What the panel must
not do is listed below as a rule. The list of commands is not the decision. A subcommand added
later is reachable unless it falls under one of these rules:

| Refused in the panel                                                                                     | Reason                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tyto plugin install <npm spec>` on Windows                                                              | `npm pack` goes through `cmd.exe` there (`runNpm`). A spec typed in the panel would reach a shell, which decision 8 rules out. A folder or a git URL installs without a shell. |
| `--trust` on any command                                                                                 | It trusts a folder for one run without the window's trust box. In the window, trust is decided only through `workspace:trust` (ADR 0111, ADR 0113).                            |
| a command that would start a shell or an editor, or run `$EDITOR`, a pager or any program the user names | Decision 8. No subcommand does this today. The rule exists for the next one.                                                                                                   |

Each refusal is a diagnostic in the panel with exit code 1, the one the CLI already gives a
refused command line. It names the rule and says what to do instead.

### 3. A command with a window twin stays consistent with the window

The CLI and the window share library code for the three overlaps. The environment also hands the
CLI the window's instances, so a command and the window share one of each:

- **`tyto render`** rasters through the window's own rasterizer instance. Captures from the panel
  and from the export box therefore queue on one adapter, under its deadline (ADR 0030). The
  trust answer is read from the same store as the window's. A restricted folder renders the way
  ADR 0111 says, in both. `--out` keeps ADR 0111's rule: a typed folder wins and is not confined.
- **`tyto plugin sync`** asks its approvals in the same native box as the window's sync
  (`approveInABox`, ADR 0151 decision 6). When it finishes, main runs the window's own sync. The
  fetched plugin set then reloads, and the explorer and the template list see the new copies.
- **`tyto delivery new`** writes through `createDelivery`, the same writer as "Delivery: New…".
  Main then pushes `explorer:changed`.
- **`tyto trust add | remove`** writes the same `trust.json` the window reads. Main then re-reads
  the open folder's trust, as `workspace:trust` does.
- **`tyto plugin install | remove | enable | disable`** changes `TYTO_HOME`. The window starts its
  installed plugins once for its life (ADR 0044), so the panel prints that the change applies
  after a restart. A terminal says the same.
- **`tyto watch <folder>`** follows the queue's rule of one consumer per folder (`queue.ts`). It
  is refused while that folder is the queue panel's folder with auto-run on. A watch in the
  panel ends when its panel session closes, when the window opens another workspace folder, or
  when the app quits. Each of those fires the run's signal.

### 4. Approvals are native boxes from main, never a page the renderer draws

**`environment.confirm` is a native message box shown by main**, in the window's language. It
works the way `approveInABox` already does: the safe answer is the default and what Escape gives,
as `[y/N]` is at a terminal. The renderer never answers a permission question. A renderer that
could say "yes" would let any script in the page approve a plugin's permissions. A box that main
owns is a surface the page cannot click. `--yes` keeps its meaning: whoever typed it answered in
advance.

While a box is open, main pushes `cli:state` with `waiting` so the panel can say what it is
waiting for. No reply travels back on a push (ADR 0029).

### 5. What crosses into the renderer: output text and typed events, on named channels

Every channel is declared in `apps/desktop/shared/ipc.ts`, validated by its schema and exposed
through the typed preload. It goes through `contextIsolation: true` and `nodeIntegration: false`,
like every other channel.

| Channel        | Kind                  | Carries                                                                                      |
| -------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `cli:run`      | invoke                | `{ argv: string[] }` → `{ runId }`; argv is an array of words, never a command line to parse |
| `cli:cancel`   | invoke                | `{ runId }` → `{}`; fires that run's signal                                                  |
| `cli:commands` | invoke                | `{}` → the reachable tree (names, arguments, options, descriptions) for help and completion  |
| `cli:output`   | event (main → window) | `{ runId, stream: 'out' \| 'err', text }`; text only                                         |
| `cli:state`    | event (main → window) | `{ runId, state: 'running' \| 'waiting' \| 'finished' \| 'cancelled', code?, question? }`    |

`command:run` is taken: the menu's command ids use it (ADR 0029). The panel's channels use their
own `cli:` prefix. A new channel goes into the three hand-written lists that `shared/ipc.ts`
documents.

### 6. Cancel fires a signal, and a command that cannot honour it says so

The panel's Stop calls `cli:cancel`, and the run's `AbortSignal` fires. `watch` stops between
sweeps. A render stops between frames, because `runJob` already lets a frame that is in flight
finish. A command that takes no signal runs to its end. The panel then shows `cancelled` at once
and prints that the command is still finishing. It never claims the command stopped when it did
not.

**Exit codes are the CLI's, unchanged:** 0 ok, 1 error diagnostics or a refused command line, 2
internal failure (ADR 0011, `EXIT_CODES` in `@tyto/io`, `run` in `program.ts`). **A cancelled run
has no exit code.** The CLI defines none for it, and inventing one would change a published
contract (`docs/render-contract.md`). The panel shows the state `cancelled` instead of a number.

### 7. Diagnostics become Problems rows, and the text stays the text

A command's diagnostics are already structured before `formatDiagnostics` prints them. The new
diagnostics sink receives each `Diagnostic`, with its code, severity, message and the file and
range that `registerOrigin` attached. Main adds each one to the Problems panel, under the run
that produced it. A row with a file and range opens that file at the range. The printed text
still reaches `cli:output` unchanged, so the panel reads like a terminal and `--json` still
prints its document.

### 8. No shell, no arbitrary program

The panel runs `tyto` and nothing else. `cli:run` takes words and hands them to `commander`, so
nothing reads `|`, `>`, `&&`, `$VAR` or a glob. A word that looks like one of those is an
argument like any other. No `child_process` call is made for the panel itself. The only child
processes a command starts are the ones the same command starts in a terminal:

- a plugin's process, through the bundled-Node launcher;
- `git`, for a plugin file's source or a git install, through `execFile` with no shell;
- `npm pack` for an npm install, except on Windows, where decision 2 refuses it.

This is not the user-script tier that ADR 0079 declined. A person can run only Tyto's own
commands, with Tyto's own permissions and trust rules.

### 9. The full terminal is out of scope, and these are its conditions

TYTO-497 needs an ADR of its own. That ADR must at least settle these points:

- **A pseudo-terminal per platform.** `node-pty` is a native module. It needs prebuilt binaries
  for each platform and Electron ABI in the installer, an install script that the
  `electron-builder` pipeline runs, and its own measurement against ADR 0067's fuses and the
  Windows App Control behaviour already seen with new executables.
- **A shell is the point of a terminal**, so decision 8 does not carry over. The terminal ADR has
  to say which shell runs, with what environment (no credentials from `safeStorage`, no
  `TYTO_PLUGIN_*` variables unless the person exports them), and that it runs under the
  person's account with no Tyto permission model on top. It has to be a separate surface from
  this panel, so that the panel's guarantees stay true.
- **Rendering and input** (an xterm-style widget in the renderer, key handling against the
  keybinding table of ADR 0074, copy and paste) and **process lifetime** (a terminal survives
  a workspace change and ends when the app quits).

Nothing in this ADR prevents any of that. The panel and a terminal can sit side by side, and the
panel's channels are not reused for a byte stream.

## Consequences

- No code in this pull request. TYTO-495 extracts the command tree into the package and adds
  the ports from decision 1, the desktop environment and the `cli:` channels. TYTO-496 builds the
  panel: input, history, output, Stop, completion from `cli:commands`, and Problems rows. Each
  documents its part in the user manual, in both editions (ADR 0101).
- `apps/cli` behaves as it does today. Its environment fills each new port with what the
  terminal already did, so `docs/render-contract.md` does not change.
- The first render of a template in an app session holds main for about 115 to 153 ms on this
  machine (Context). That is over the 100 ms threshold, and the panel shares it with the
  preview. It is not hidden. If it needs to go, it goes for the window and the panel together
  (decision 1).
- A command that never yields freezes the window, and an exception that escapes every awaited
  chain reaches the crash box. A child process would have contained both. That isolation was
  given up for sharing the window's rasterizer, plugins, trust and boxes.
- Not measured: the same lag inside Electron's main rather than in plain Node on the bundled
  Node; a render with raster output (only `--types svg` was timed, because the raster capture
  leaves main); macOS and Linux.
- Not decided: a history of past runs that survives a relaunch; whether the panel can run two
  commands at once (the channels allow it, because each run has its own `runId`).

## Rejected

- **A child process on the bundled Node, running the CLI.** It is isolated and can be killed,
  and it costs about 334 ms to start before every command. It is cold on every command, needs a
  4 MB self-contained CLI beside the app, and would need either a Playwright browser (272 MB or
  more) or a raster bridge back to main. It shares none of the window's plugins, trust state or
  approval box, so each of decision 3's rules would become a protocol (Context).
- **Importing `apps/cli` from `apps/desktop`.** The two apps cannot import each other
  (`plugin-process.ts`, `CLAUDE.md`).
- **A `utilityProcess`.** It is Electron run as Node, which ADR 0049 measured as not enforcing
  `--permission`, and it brings the same isolation trade as a child process with none of its
  savings.
- **Running `watch` only in a terminal.** The maintainer asked for the panel to be as complete
  as possible, and a long-running command is what Stop is for.
- **Approvals drawn by the renderer** (decision 4).
- **A new exit code for "cancelled"** (decision 6).
