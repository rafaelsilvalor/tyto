# 0164 — A terminal tab runs the person's shell in main, through node-pty

Status: accepted · 2026-10-31 · TYTO-497 · epic E20 (TYTO-493) · settles the conditions of ADR
0159 decision 9 · amends ADR 0074 (a seventh keybinding context) · builds on ADR 0024, ADR 0067,
ADR 0073, ADR 0111, ADR 0113 and ADR 0163

## Context

On 2026-10-30 Rafael asked for a command panel inside the window, then a full terminal, "as
complete as possible in what it can do and in usability". The panel is ADR 0159, built by
TYTO-495 and TYTO-496. ADR 0159 kept the terminal out of scope and listed what its own ADR must
settle (decision 9): a pseudo-terminal per platform, measured against the fuses of ADR 0067 and
against Windows App Control; which shell runs, with what environment, under whose account; a
surface separate from the panel; rendering, keys, copy and paste; and process lifetime.

A pseudo-terminal (a PTY) is what makes a program believe it is talking to a real console: line
editing, colours, a prompt, `Ctrl+C` as an interrupt, a size it can be told about. Electron has
none. `node-pty`, the module VS Code's terminal uses, provides one: ConPTY on Windows,
`forkpty` on macOS and Linux. It is a native module, so before this ADR TYTO-497 measured whether
it packages.

### The measurement

A draft probe pull request (rafaelsilvalor/tyto#275, closed unmerged) added `node-pty@1.1.0` and
`@xterm/xterm@6.0.0` to `apps/desktop` and ran `desktop.yml`'s four legs three times: A without
them, B with them, C with B plus one configuration line. A probe in main, behind an environment
variable, spawned the platform's shell through node-pty inside the **packaged** app, typed a
command whose answer (`TYTO_PTY_42`) never appears in the typed text, and checked that the answer
came back. Runs 41198426325 (A), 41198706837 (B) and 41198936689 (C).

| Leg            | Artifact                       | Without (A) | With node-pty | Delta              |
| -------------- | ------------------------------ | ----------- | ------------- | ------------------ |
| windows-latest | `Tyto Setup 0.13.0.exe` (nsis) | 138 161 681 | 142 677 754   | +4 516 073 (+3.3%) |
| windows-latest | `Tyto 0.13.0.exe` (portable)   | 137 994 696 | 142 510 773   | +4 516 077         |
| ubuntu-latest  | `Tyto-0.13.0.AppImage`         | 174 381 396 | 175 275 162   | +893 766 (+0.5%)   |
| macos-latest   | `Tyto-0.13.0-universal.dmg`    | 312 017 859 | 312 927 584   | +909 725 (+0.3%)   |
| macos-26-intel | the same universal `dmg`       | 312 018 336 | 312 927 497   | +909 161           |
| all            | renderer JavaScript            | 3 308.98 kB | 3 721.30 kB   | +412 kB (xterm)    |
| all            | main bundle                    | 528.92 kB   | 528.92 kB     | 0                  |

Sizes are bytes from `ls -l release/` in each job's log. The Windows unpacked folder grew by
21.8 MiB. Of that, about 15.6 MiB was compiler leftovers beside the module (`.iobj`, `.ipdb`,
`.lib`, `obj/`) and 5 MiB was every platform's prebuilt binaries. The files the app loads are
about 1.5 MiB. The probe shipped them all because its `files` list was not filtered.

| Leg                        | Module loads | Shell answered | Shell            |
| -------------------------- | ------------ | -------------- | ---------------- |
| windows-latest             | yes          | yes, in 3 s    | `powershell.exe` |
| ubuntu-latest (under xvfb) | yes          | yes, in 2 s    | `/bin/bash`      |
| macos-latest (arm64)       | yes          | yes, in 2 s    | `/bin/bash`      |
| macos-26-intel (x64 slice) | yes          | yes, in 3 s    | `/bin/bash`      |

What the runs found:

- **The universal `dmg` refuses node-pty as shipped.** Both macOS legs of B failed:
  `Detected file "…/node-pty/prebuilds/darwin-arm64/pty.node" that's the same in both x64 and arm64 builds and not covered by the x64ArchFiles rule`.
  node-pty ships both macOS binaries in each slice, and `@electron/universal` will not merge
  identical files it was not told about. C added `mac.x64ArchFiles` for that folder and passed.
- **electron-builder compiles node-pty from source on all three platforms**, and the compiled
  binary is the one that loads. Its `@electron/rebuild` step logs
  `preparing moduleName=node-pty`. The packaged Windows `build/Release/pty.node` differs from
  node-pty's prebuilt `prebuilds/win32-x64/pty.node`, and node-pty's loader tries `build/Release`
  first. node-pty 1.1.0 has no Linux binary at all, so `pnpm install` already runs `node-gyp` on
  Linux. **So any machine that packages the app needs a C++ toolchain**: Visual Studio's build
  tools, Xcode's command-line tools, or gcc and make. GitHub's runners have one.
- **The fuses do not get in the way.** node-pty starts the shell from native code: ConPTY on
  Windows, its own `spawn-helper` executable on macOS. It never calls Node's `fork`, so ADR
  0067's `runAsNode: false` does not apply to it. All four legs ran with the five fuses as
  configured.
- **Smart App Control did not block it on the maintainer's machine.** Smart App Control was in
  Enforce mode (`VerifiedAndReputablePolicyState` = 1). Both downloaded folders were run from
  `C:\projects\tyto\testes\TYTO-497\`, A's first. A's unsigned `Tyto.exe` kept running. B's
  unsigned `Tyto.exe` loaded the unsigned `pty.node` the runner had compiled, and its shell
  answered. Code Integrity logged no event for either path. This is one sample: the same machine
  has blocked other new executables before, intermittently.
- **Build time could not be measured with one run per leg.** The same step varied by up to
  ±35 s between runs. The one consistent rise was Windows' packaged-app gate, from 44 s to
  143 s and 100 s, which is where the compile happens. On the arm64 Mac, A and C ran on
  different runner images (20261026.0455.2 and 20261021.0445.8). Every other leg ran on the same
  image in each run.

## Decision

### 1. node-pty, in main

The terminal is a real PTY from `node-pty`, created and owned by main. The measurement shows the
module loads in the packaged app on Windows, Linux and both Mac architectures. The cost is 0.3 to
3.3% of the installer, before the file filtering in decision 2.

The alternative without a native module was a shell started by main with `child_process.spawn`,
talking through pipes. It is rejected because a shell with no console under it is not a
terminal:

- PowerShell has no line editing and no history keys.
- Programs see no TTY, so `git`, `ls` and test runners drop colours and progress bars.
- Interactive programs break: `vim`, `ssh` password prompts, a Python or Node prompt.
- The window size cannot be passed to the program.
- On Windows, `Ctrl+C` cannot be sent as an interrupt.

It would be the panel with a shell behind it. ADR 0159 decision 8 already keeps the panel free of
shells.

### 2. How it is packaged

- `node-pty` is a `dependencies` entry of `apps/desktop`, so `externalizeDepsPlugin` keeps it out
  of the main bundle. `pnpm-workspace.yaml`'s `allowBuilds` gains `node-pty: true`, with its
  reason in a comment.
- `electron-builder.yml` brings it back the way `@tyto/templates` and `@tyto/fonts` come back:
  as a real package. It is unpacked from the asar, because a native module cannot be loaded from
  inside one.
- **Each platform ships only the files it loads**: `package.json`, `lib/`, and the binaries in
  `build/Release/` (`pty.node` everywhere; `conpty.node`, `conpty_console_list.node` and the
  winpty pair on Windows; `spawn-helper` on macOS). No `prebuilds/`, which the compiled binary
  makes dead weight, and no compiler leftovers.
- `mac.x64ArchFiles` stays only if the build still ships a file that is identical in both
  slices. Without `prebuilds/` it may not be needed. The build card measures which.
- electron-builder's own rebuild stays on, because it is the path all four legs measured. The
  toolchain requirement goes into the contributor docs next to `test:package`. Switching it off
  with `npmRebuild: false`, to load node-pty's prebuilt binaries on Windows and macOS (they use
  N-API, which does not depend on the Electron version), was not measured. It is left open
  below.
- `test:package` gains the probe as a test: the packaged app opens a terminal, runs `echo`, and
  reads the answer back. This runs on all four legs of `desktop.yml` and of `desktop-e2e.yml`.

### 3. Main owns the shell; the renderer draws and types

The renderer runs `@xterm/xterm`. It draws what main sends and sends what the person types. It
never chooses the program, the folder or the environment. These are the channels, declared in
`shared/ipc.ts` with Zod like every other channel, under their own `terminal:` prefix. The
panel's `cli:` channels are not reused for a byte stream (ADR 0159 decision 9).

| Channel           | Kind                  | Shape                                                                                                      |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `terminal:open`   | invoke                | `{ cols, rows }` → `{ terminalId, title }`, or a refusal with its reason (decision 5); no path, no program |
| `terminal:input`  | invoke                | `{ terminalId, data }` → `{}`; `data` is the text typed or pasted                                          |
| `terminal:resize` | invoke                | `{ terminalId, cols, rows }` → `{}`                                                                        |
| `terminal:kill`   | invoke                | `{ terminalId }` → `{}`; ends the shell and every process it started                                       |
| `terminal:list`   | invoke                | `{}` → the open terminals, `{ terminalId, title, replay }[]`, so a reloaded window reattaches              |
| `terminal:output` | event (main → window) | `{ terminalId, data }`; main batches output to one event per animation frame per terminal                  |
| `terminal:exit`   | event (main → window) | `{ terminalId, code }`                                                                                     |

`title` is the shell's name ("PowerShell", "zsh"), never a folder. **No channel takes a path or a
command line**, which keeps ADR 0113's rule. The shell's own prompt may print a folder: that is
the shell's output, not the window naming one.

`replay` is what main kept of the terminal's recent output, capped at 256 KiB per terminal. With
it, a window reload (`Ctrl+R`, TYTO-104) does not lose what was on screen. Each new channel goes
into the hand-written lists that `shared/ipc.ts`'s tests and `e2e/window.desktop.test.ts` keep.

### 4. Which shell, where, with what environment

- **Shell.** On Windows: PowerShell 7 (`pwsh.exe`) when it is on `PATH`, otherwise Windows
  PowerShell (`powershell.exe`). On macOS and Linux: the person's login shell (`$SHELL`), falling
  back to `/bin/zsh` on macOS and `/bin/bash` on Linux. On macOS it starts as a login shell
  (`-l`), because an app opened from the Dock does not inherit the login `PATH`. The person
  overrides this with `terminal.shell` and `terminal.args` in the user settings file. **These keys
  are read from the user layer only** (ADR 0073), never from a workspace or a profile. A folder
  that chose the program to run would be a source shipping code (ADR 0111).
- **Folder.** A new terminal starts in the open workspace folder. With no folder open, it starts
  in the person's home folder.
- **Environment.** Main's own environment, minus `TYTO_PLUGIN_*`, `ELECTRON_*` and `NODE_OPTIONS`.
  Plus `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=Tyto`. **Nothing from
  `safeStorage` is ever put in it.** A variable the person exports inside the shell is theirs.
- **Account.** The shell runs as the person, with the person's permissions, and **with no Tyto
  permission model on top**. Tyto's trust rules and plugin permissions do not apply inside it.
  That is what a terminal is.

### 5. Off in a restricted workspace, until it is trusted

`terminal:open` is refused **in main** while the open workspace is restricted (ADR 0111). Hiding
the tab is not the check. The tab shows the same banner line the other withheld features show,
with the trust action beside it. The reason is that a shell started in a folder runs that folder's
files without anybody typing a command. Prompt tools run `git` in it, and a copied folder's
`.git/config` can name a program for `git` to start (`core.fsmonitor`). `direnv` loads `.envrc`.
A trusted workspace, or no workspace at all, opens a terminal.

A terminal already open keeps running when the window opens another folder (ADR 0159 decision 9),
in the folder it started in. A restricted folder opened later refuses only new terminals.

### 6. Lifetime

- A terminal lives in main. It survives a workspace change and a window reload.
- It ends when the person closes its tab or the shell exits, and every terminal ends when the app
  quits. `terminal:kill` and quitting end the shell's whole process tree: ConPTY closes the
  console on Windows, and node-pty signals the process group on macOS and Linux.
- Quitting while a program is still running in a terminal asks first, in a box main owns
  (ADR 0159 decision 4).

### 7. A tab in the bottom strip

The terminal is one more tab in ADR 0163's strip: Problems, Commands, Terminal, then Project and
plugin panels.

- **Several terminals** show as small session tabs at the right of the strip, as the command
  panel's sessions do (ADR 0163 decision 6), with a `+` that opens another.
- The xterm code is loaded the first time the tab is put in front. The other tabs and window
  start-up do not pay for the 412 kB.
- **Keys.** ``Ctrl+Shift+` `` opens a new terminal. ``Ctrl+` `` stays the command panel's key (TYTO-496).
- **Split panes, link detection and themes beyond the window's own colours** come after the first
  pull request. They are the card's later steps.

### 8. Keys, copy and paste

- ADR 0074's six closed contexts become seven: **`terminal`** means focus is in a terminal.
- While it has focus, keys go to the shell, except the entries the table binds in the `terminal`
  context or globally (the command bar, the bottom area's toggles).
- On Windows and Linux: `Ctrl+C` copies when text is selected and otherwise sends an interrupt,
  as VS Code does. `Ctrl+Shift+C` and `Ctrl+Shift+V` copy and paste. On macOS: `Cmd+C` and
  `Cmd+V`.
- A paste of more than one line asks before it is sent, so a pasted script does not run line by
  line by surprise.
- When links come, an `http(s)` link opens through main's `shell.openExternal`, the door
  the manual and the update notice already open pages through.

### 9. What changes for security

- **The renderer can now cause programs to run.** Until this ADR, script running in the window
  could reach only `tyto` commands and their rules. From the first terminal on, script in the
  window can open a terminal and type into it, which means anything the person's account can do.
  So the defences that keep foreign script out of the renderer become the terminal's defences
  too, and nothing may weaken them:
  - `contextIsolation`;
  - the sandboxed preview `iframe`;
  - the page's Content-Security-Policy, which allows no remote script;
  - plugins running in their own process, never in the renderer (ADR 0044).
- **A plugin gets no terminal.** No `plugin-api` service opens a terminal, writes to one or reads
  its output. Extending that would need its own ADR.
- **The panel's guarantees stay true.** `cli:run` still runs `tyto` and nothing else. The
  terminal is a separate surface on separate channels, and the panel never reads `terminal:*`.
- **The installers stay unsigned**, as they are today. On the measured machine, the missing
  signature blocked neither the executable nor the native module. A signed release is still the
  separate decision `docs/git-workflow.md` describes.

## Consequences

- `apps/desktop` gains its first native dependency. A machine that runs `test:package` or
  packages the app needs a C++ toolchain, and the contributor docs say so.
- The Windows installer grows by about 4.5 MB before file filtering. The other installers grow
  by under 1 MB.
- ADR 0074's context list gains `terminal`, and the keybinding table's validation accepts it.
- TYTO-497 continues in pull requests after this ADR:
  1. packaging and the channels, with the packaged `echo` test;
  2. the tab, keys, copy and paste, with a desktop e2e that opens the terminal and runs `echo`,
     and the window looked at;
  3. split panes, links and themes.

## Left open

| What                                                                                | Why it matters                                                                                      | Status       | Owner    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------ | -------- |
| Load node-pty's prebuilt binaries (`npmRebuild: false`) instead of compiling them   | It would drop the toolchain requirement on Windows and macOS packaging machines                     | Not measured | TYTO-497 |
| Smart App Control on more than one machine and one day                              | It was one sample; the same machine has blocked new executables before                              | Not measured | TYTO-497 |
| Build time with node-pty                                                            | With one run per leg the runs varied by more than the change. Only Windows' packaging rise is clear | Not measured | TYTO-497 |
| ``Ctrl+Shift+` `` for a new terminal, with ``Ctrl+` `` staying on the command panel | VS Code puts the terminal on ``Ctrl+` ``. This ADR keeps the command panel there                    | Open         | Rafael   |
