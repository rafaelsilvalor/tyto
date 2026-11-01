# @tyto/command-line

## 0.2.1

### Patch Changes

- Updated dependencies [e94aa55]
  - @tyto/core@0.36.1
  - @tyto/export-html@0.7.10
  - @tyto/export-svg@2.0.10
  - @tyto/fonts@0.4.1
  - @tyto/google-fonts@0.1.9
  - @tyto/io@5.2.1
  - @tyto/pipeline@0.12.6
  - @tyto/plugin-api@0.13.1
  - @tyto/raster@0.2.3
  - @tyto/template-lang@0.8.9
  - @tyto/templates@1.2.2

## 0.2.0

### Minor Changes

- 8dd4503: The command tree says what each argument and option takes, for the window's completion (TYTO-496): `commandTree` gives each option its long and short flag, whether it takes a value, and, where `program.ts` says so beside the definition, the kind of value (a brief, a file, a folder, a template, format ids, output types with the built-in four as choices, or a plugin). `valuesOf` refuses a name the command does not declare, so a renamed option fails when the program is built. Nothing a command accepts or refuses changes.
- 9bcb68b: `tyto gallery list | install | update` reads the curated index when neither `--index` nor `TYTO_GALLERY_INDEX` names one (TYTO-506, ADR 0162): `DEFAULT_GALLERY_INDEX`, a plain git location exported by `@tyto/plugin-api`. `--index` wins over the variable, and the variable over the default.

### Patch Changes

- 213f553: TYTO-504: `tyto gallery list | install | update` print what `@tyto/io`'s gallery operations answer; what they write and say is unchanged.
- 9021b50: Rename shadowing local bindings without changing behavior and enforce the no-shadow lint rule.
- Updated dependencies [213f553]
- Updated dependencies [9021b50]
- Updated dependencies [93fb9c9]
- Updated dependencies [147eafa]
- Updated dependencies [bd56ec5]
- Updated dependencies [9bcb68b]
- Updated dependencies [05c9f83]
  - @tyto/io@5.2.0
  - @tyto/core@0.36.0
  - @tyto/pipeline@0.12.5
  - @tyto/plugin-api@0.13.0
  - @tyto/template-lang@0.8.8
  - @tyto/export-html@0.7.9
  - @tyto/export-svg@2.0.9
  - @tyto/raster@0.2.3
  - @tyto/fonts@0.4.1
  - @tyto/google-fonts@0.1.8
  - @tyto/templates@1.2.1

## 0.1.0

### Minor Changes

- cd5e075: New package: the `tyto` command tree, moved out of `apps/cli` so the desktop can run the same commands in its main process (ADR 0159). `CliEnvironment` gains `launch`, the port that starts an installed plugin's process; the package chooses no launcher and no rasterizer on an app's behalf.
- 787c4ce: `environment.diagnostics` receives every diagnostic a run prints, already placed at the file, line and column the printed text names (ADR 0159 decision 7). The sink belongs to the run, so two runs at once each receive only their own diagnostics. What a command prints does not change: across the package's suite, the 113 printed outputs were byte-identical before and after.
- a5a896a: `run(argv, environment, signal)` stops a run part of the way through: `render` between frames, `watch` between sweeps (ADR 0159 decision 6). `environment.refuse` is asked before every command with its path, arguments and parsed options; a sentence refuses the command with exit 1. `environment.shellRefusal` makes a run fail at any step that would start a shell, which today is `npm` on Windows, whichever command reached it. `commandTree` describes the command tree as data. A terminal sets none of these, so `tyto` behaves as before.
- 4168183: `tyto gallery list | install <id> | update <id>` (TYTO-503, ADR 0162). The index is `--index <git>` or `TYTO_GALLERY_INDEX`. `list` shows each entry as installed, update available or not installed against the machine's plugin files and lock; `install` writes it into `~/.tyto/plugin-files` pinned to its latest tag and syncs; `update` moves its ref where it lives and syncs, refusing a ref changed by hand since the gallery wrote it unless `--force`.

### Patch Changes

- Updated dependencies [fc3bee5]
- Updated dependencies [fc3bee5]
- Updated dependencies [04233fc]
- Updated dependencies [6881557]
- Updated dependencies [6881557]
- Updated dependencies [4168183]
- Updated dependencies [4168183]
- Updated dependencies [4168183]
  - @tyto/templates@1.2.0
  - @tyto/core@0.35.0
  - @tyto/fonts@0.4.1
  - @tyto/plugin-api@0.12.0
  - @tyto/template-lang@0.8.7
  - @tyto/io@5.1.0
  - @tyto/pipeline@0.12.4
  - @tyto/export-html@0.7.8
  - @tyto/export-svg@2.0.8
  - @tyto/google-fonts@0.1.7
  - @tyto/raster@0.2.2
