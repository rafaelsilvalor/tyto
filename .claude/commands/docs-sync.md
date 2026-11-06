Bring the user manual in step with this branch: regenerate the Reference pages the diff
reaches, list the manual pages changed in one edition only, flag app-data paths written with a
literal version, then build the manual and run its tests. Translate nothing on your own.
$ARGUMENTS is optional; `all` sweeps every page of the manual in steps 4 and 5, not only the
changed ones.

AGENTS.md holds the four rules this command follows: after settings, commands, status bar or
font changes, the generated Reference pages are updated; a page added to one edition of the
manual is added to the other in the same PR (ADR 0101, `apps/docs/test/parity.test.ts`); docs
write app-data paths as shapes (`<appData>/Tyto/<version>/logs`), never a literal version; and
the docs tests read the built site, so the manual is built first, always. Run from the
repository root, in Git Bash or a Linux shell, with `node_modules` installed and the parsers
generated (`/fresh-worktree`). Paste each command's output verbatim.

1. **List what the branch changed.** Committed and uncommitted changes against a fresh
   `origin/main`, plus the untracked files, because a page written and not yet added is exactly
   the half the parity test is about:

   ```bash
   git fetch origin main && { git diff --name-only origin/main; git ls-files --others --exclude-standard; } | sort -u
   ```

   Nothing printed means a clean branch: steps 2 to 5 then report "nothing affected" and step 6
   still builds and tests the manual.

2. **Decide whether the Reference pages are reached.** The ten Reference pages
   (`apps/docs/pages/reference/*.md` and `pages/pt-BR/reference/*.md`: settings,
   keyboard-shortcuts, commands, command-line, themes) are rendered by
   `tools/docs-gen/src/reference/*.ts`. The table below is what those renderers import, found
   with this grep; **when a renderer gains an import, the table is stale**: rerun it and update
   the table in the same PR.

   ```bash
   grep -n "from '" tools/docs-gen/src/reference/*-page.ts tools/docs-gen/src/reference/window-commands.ts
   ```

   | Source path in the diff                          | Pages it reaches                               | Read from                                                                                                         |
   | ------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
   | `apps/desktop/shared/**`                         | settings, keyboard-shortcuts, commands, themes | source: `settings.ts` (and the modules it gathers), `i18n/`, `layout.ts`, `theme-setting.ts`                      |
   | `apps/desktop/src/renderer/commands.ts`          | keyboard-shortcuts, commands                   | source, through `window-commands.ts`                                                                              |
   | `apps/desktop/src/main/desktop.tyto-plugin.json` | settings                                       | source                                                                                                            |
   | `apps/desktop/src/main/themes/*.json`            | themes                                         | source                                                                                                            |
   | `packages/plugin-api/src/**`                     | settings                                       | **`dist`** (`declaredSetting`, `outlineOf`; `shared/settings.ts` too)                                             |
   | `packages/editor/src/**`                         | keyboard-shortcuts, commands                   | **`dist`** (keybindings, `COMMAND_BAR_TOGGLE`)                                                                    |
   | `packages/command-line/src/**`                   | command-line                                   | **`dist`** (`createProgram`)                                                                                      |
   | `packages/theme-pack/src/**`                     | themes                                         | **`dist`** (`THEME_PACK_THEMES`)                                                                                  |
   | `tools/docs-gen/src/reference/<page>-page.ts`    | that page                                      | source; `markdown.ts` and `pages.ts` reach all five, `window-commands.ts` reaches keyboard-shortcuts and commands |
   | any other `packages/*/src/**`                    | unknown                                        | **`dist`**, through the packages above: regenerate, expect no page in particular                                  |

   The `@tyto/*` packages resolve to their `dist` (each `package.json` exports `./dist/index.js`,
   and `tools/docs-gen` has no Vitest alias), so **a page rendered before its packages are
   rebuilt is rendered from the old code, and the run still passes**. That is how a page stays
   stale while the generator claims success (TYTO-353): measured on TYTO-579, a description
   changed in `packages/command-line/src/program.ts` left `command-line.md` unchanged under
   `vitest run --update` with every test green, and changed it once the packages were rebuilt.
   Step 3 rebuilds first for that reason.

   Classify the diff of step 1 against the table:

   ```bash
   { git diff --name-only origin/main; git ls-files --others --exclude-standard; } | sort -u | grep -E '^(apps/desktop/shared/|apps/desktop/src/renderer/commands\.ts$|apps/desktop/src/main/desktop\.tyto-plugin\.json$|apps/desktop/src/main/themes/|packages/[^/]+/src/|tools/docs-gen/src/reference/)'
   ```

   Nothing printed: say **"no Reference page affected"**, and still run the comparison (no
   `--update`), which proves the committed pages match the code and takes seconds:

   ```bash
   pnpm --filter @tyto/docs-gen exec vitest run --reporter=verbose src/reference/pages.test.ts 2>&1 | grep -E 'Test Files|Tests |FAIL|×'
   ```

   Anything printed: write down, from the table, the pages each line reaches, and go to step 3.
   When unsure of a path, count it as reaching every page: regenerating is one run of a few
   seconds whatever the diff, and it renders all ten files anyway.

3. **Rebuild, regenerate, and show what moved.** Build the packages the generator reads, the
   same build `pnpm docs:gen` runs first; turbo's summary must show every task successful:

   ```bash
   pnpm exec turbo run build --filter=@tyto/docs-gen... 2>&1 | grep -E '^ *(Tasks|Cached|Failed): '
   ```

   Then rewrite the pages. `pnpm docs:gen` would also rewrite `docs/diagnostic-codes.md`, the
   render contract and the template gallery; this command touches the Reference pages only.
   Keep the verbose reporter: with the default one, an `--update` run was seen summing
   `4 passed (4)` test files while it ran only this one.

   ```bash
   pnpm --filter @tyto/docs-gen exec vitest run --update --reporter=verbose src/reference/pages.test.ts 2>&1 | grep -E 'Test Files|Tests |FAIL|×'
   ```

   A red here is not a stale page: the suite's other tests (every setting described, every
   command titled in both languages, no key bound to a missing command) failed. Paste it and
   stop; that is a fix in the source, not in the page.

   Then show what moved, the summary first and the diff after:

   ```bash
   git diff --stat -- apps/docs/pages/reference apps/docs/pages/pt-BR/reference
   ```

   ```bash
   git diff -- apps/docs/pages/reference apps/docs/pages/pt-BR/reference
   ```

   Compare with the pages you wrote down in step 2. **A page the table expected to change that
   did not is reported, never hidden**: either the change does not reach the page's text (say
   which), or the page was rendered from stale code (rebuild and rerun). Both editions of a page
   move together; one moving without the other is reported too.

4. **List the manual pages changed in one edition only.** `parity.test.ts` compares **file
   sets**, nothing inside the files: every English page has a pt-BR page at the same path
   under `pages/pt-BR/` except the English-only author guides (`ENGLISH_ONLY_PAGES` in
   `apps/docs/src/sections.ts`), those guides exist in English and not in pt-BR, every section
   has an `index.md` in each edition, and every page the sidebar lists exists in each edition.
   It does not compare headings or content, and it cannot see a page **changed** in one edition
   while its twin stayed as it was: that passes the test, and is flagged here for review. The
   script reads the pages changed against `origin/main`, committed or not, untracked ones
   included, and the `ENGLISH_ONLY_PAGES` list as text; it prints one line per page,
   `MISSING HALF`, `ONE EDITION`, `both editions` or `english-only guide`:

   ```bash
   node tools/repo-checks/src/docs-edition-pairs.mjs
   ```

   With `all`, the file-set half is the parity test itself, which step 6 runs.

   For each **MISSING HALF**, ask the maintainer whether to write the missing page; write it
   only when he says so, and only that page. For each **ONE EDITION**, show the changed hunk
   and ask whether the other edition needs the same change. The pt-BR edition may lag in
   wording, never in structure (ADR 0101), so "no" is a valid answer: report it as his.

5. **Flag app-data paths written with a version.** Only a path: `Tyto/`, `Tyto\` or
   `Tyto%5C` followed by a version number. A version in prose, in a release note's name or in
   a download file name (`pages/release-notes/desktop-v0.14.1.md`, `Tyto-0.14.1-setup.exe`) is
   not a path and is not flagged.

   ```bash
   { git diff --name-only --diff-filter=d origin/main -- apps/docs/pages; git ls-files --others --exclude-standard -- apps/docs/pages; } | grep -E '\.md$' | sort -u | xargs -r grep -nE 'Tyto(/|\\|%5C)v?[0-9]+\.[0-9]+(\.[0-9]+)?' --
   ```

   With `all`, the same grep over `apps/docs/pages` with `-r`. Nothing printed means nothing
   flagged. For each hit, suggest the shape `<appData>/Tyto/<version>/…` (in pt-BR,
   `<versão>`), the way `get-started/install.md` writes it, and change it only when asked.

6. **Build the manual, then run its tests**, always in this order: the tests read the built
   site, so a test run without a fresh build checks the last build, not this branch.

   ```bash
   pnpm --filter @tyto/docs build 2>&1 | tail -4
   ```

   ```bash
   pnpm --filter @tyto/docs test 2>&1 | grep -E 'Test Files|Tests |FAIL|×|AssertionError'
   ```

   A red `parity.test.ts` summarizes the two lists (`…(58)`); the page is named in the diff
   that follows the `AssertionError`, where a `-` line is an English page with no pt-BR twin.
   Paste that diff too:

   ```bash
   pnpm --filter @tyto/docs test 2>&1 | grep -E '^ *[-+] +"'
   ```

7. **Report.** One block per step, with its command and its output verbatim: the changed paths;
   "no Reference page affected" or the regenerated pages with the `--stat` and the diff, and
   every expected page that did not move; each MISSING HALF and ONE EDITION line with the
   maintainer's answer, or the question still open; the version-path hits, or that there were
   none; the build's last lines and the tests' summary. End with what this command did not do:
   regenerate `docs/diagnostic-codes.md`, the render contract or the template gallery
   (`pnpm docs:gen`), translate a page nobody asked for, or commit.

Never commit, push or translate on your own from this command. The regenerated Reference pages
are left in the working tree for the card's commit.
