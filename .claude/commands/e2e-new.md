Scaffold a desktop e2e file from the house skeleton, register it everywhere a red CI run says
it must be, run it alone and report its time against the budget. Do not write the test itself.
$ARGUMENTS names the subject in kebab-case (`folder-tabs`) and the card key (`TYTO-123`); ask for
whichever is missing.

AGENTS.md › Desktop app and e2e holds the rules this command follows, and missing any one of
them is a red CI run: every launch gets its own `--user-data-dir` and `TYTO_HOME` and closes with
`closeApp(app)`; Vitest plus the Playwright library, so no `toBeVisible`, and waits go through
`waitForSelector`, `waitForFunction` or `expect.poll`; 60 s per file (ADR 0105); a new file under
`apps/desktop/src` or `e2e` enters `tools/repo-checks/src/desktop-e2e-map.json`; a new IPC
channel enters `shared/ipc.test.ts` and `window.desktop.test.ts`; and an i18n key that is not an
element's text goes in `NOT_ELEMENT_TEXT`. E2e is only for what needs the real window: logic goes
to unit or jsdom tests (AGENTS.md › Tests). Run from the repository root, in Git Bash or a Linux
shell, with `S` set to the subject and `K` to the card key. Paste each command's output verbatim.

1. **Check the name is free.** The file is `apps/desktop/e2e/$S.desktop.test.ts`:

   ```bash
   ls apps/desktop/e2e/$S.desktop.test.ts 2>&1; git ls-files "apps/desktop/e2e/$S*"
   ```

   The first must print `No such file`, and the second nothing. A file of that name already
   existing stops the command: say so and ask for another subject.

2. **Write the skeleton.** It is what the three shortest suites that launch the app share
   (`icon-stroke`, `terminal-tab` and `folder-tabs`, read on 2026-11-06), with the helpers they
   import: `close-app.ts` and `first-window.ts`. Replace `<subject>` and `<KEY>`, and nothing
   else:

   ```ts
   import { existsSync, mkdtempSync, rmSync } from 'node:fs';
   import { tmpdir } from 'node:os';
   import { dirname, join } from 'node:path';
   import { fileURLToPath } from 'node:url';

   import { type ElectronApplication, type Page, _electron } from 'playwright';
   import { afterAll, beforeAll, describe, expect, it } from 'vitest';

   import { closeApp } from './close-app.js';
   import { firstWindow } from './first-window.js';

   /**
    * TODO(<KEY>): one paragraph on what this suite proves in the real window, and why it
    * needs the window rather than a unit or jsdom test (AGENTS.md › Tests, ADR 0105).
    *
    * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139).
    */

   const here = dirname(fileURLToPath(import.meta.url));
   const built = join(here, '..', 'out', 'main', 'index.js');
   if (!existsSync(built)) {
     throw new Error(`${built} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
   }

   let scratch: string;
   let app: ElectronApplication | undefined;
   let page: Page;

   beforeAll(async () => {
     scratch = mkdtempSync(join(tmpdir(), 'tyto-<subject>-e2e-'));
     app = await _electron.launch({
       args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
       cwd: join(here, '..'),
       env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: join(scratch, 'tyto-home') },
     });
     page = await firstWindow(app);
     await page.waitForSelector('#editor .cm-content');
   });

   afterAll(async () => {
     await closeApp(app);
     rmSync(scratch, { recursive: true, force: true });
   });

   describe('<subject>', () => {
     it('opens its window in its own data folders', async () => {
       await page.waitForFunction(() => document.title.includes('Tyto'), undefined, {
         timeout: 10_000,
       });
       expect(await page.title()).toContain('Tyto');
     });

     it.todo('TODO(<KEY>): what the suite proves');
   });
   ```

   The first test is a smoke test that makes the launch measurable in step 6; the author
   replaces it with the card's tests. `e2e/launch-isolation.test.ts` scans every suite and holds
   the parts of this skeleton a later edit might break, so keep them:
   - every `_electron.launch` has `--user-data-dir` and `TYTO_HOME`, and every run of the CLI
     has `TYTO_HOME` in its env;
   - the first window comes from `firstWindow(app)`, never a direct `.firstWindow(` call;
   - a `beforeAll` that waits for the first window takes the config's 300 s, or passes at least
     180 000 ms; leave its timeout out, as the skeleton does;
   - `page.emulateMedia({ colorScheme: … })` with a fixed scheme needs a `// scheme:` comment
     saying why.

   `closeApp(app)` answers the quit box with _discard_; only `quit.desktop.test.ts` closes
   otherwise. Keys go through `page.keyboard`, never the operating system; click an
   `aria-disabled` control with `force: true`; scroll with `page.mouse.wheel`.

3. **Register the files in the map.** `desktop-e2e-map.test.mjs` holds four rules over
   `tools/repo-checks/src/desktop-e2e-map.json`, and the file this command wrote meets the first:
   - every `*.desktop.test.ts` on disk is named in the `e2e` list of at least one entry. Name
     the new file in the entry whose `paths` are the sources it drives (in an existing entry,
     or a new one). Its own path need not be in `paths`: a changed e2e file always selects
     itself (`e2e-select.mjs`);
   - every tracked non-test file under `apps/desktop/src` or `apps/desktop/shared` matches the
     `paths` of an entry, or one of the two lists in `e2e-select.mjs` (`RUN_EVERYTHING`,
     `REACHES_NOTHING_LOCALLY`), and never both: a map entry for a path on a list fails as
     shadowed;
   - every glob in `paths` matches at least one **tracked** path;
   - every entry has a non-empty `why`. The form is
     `reviewed: <what the files share, in the window> (<KEY>)`; `generated: …` is for entries
     a script wrote.

   A helper under `e2e/` that is not a test (`folder-switch.ts`) needs no entry: the selector
   runs every file when one changes. A new entry looks like this:

   ```json
   {
     "paths": ["apps/desktop/src/renderer/<subject>.ts"],
     "e2e": ["<subject>.desktop.test.ts"],
     "why": "reviewed: <what the suite drives in the window> (<KEY>)"
   }
   ```

   **The test reads `git ls-files`, so a file not added yet is invisible to it**: an entry
   naming a new path fails as unmatched, and a new source file with no entry passes and turns
   red on CI. Mark every new file as intended for the index, then run the test:

   ```bash
   git add -N apps/desktop/e2e/$S.desktop.test.ts <every new file under apps/desktop/src or shared>
   pnpm --filter @tyto/repo-checks exec vitest run src/desktop-e2e-map.test.mjs 2>&1 | tail -6
   ```

4. **A new IPC channel enters two lists.** List the channels the branch adds to `IPC_CHANNELS`:

   ```bash
   git diff origin/main -- apps/desktop/shared/ipc.ts | grep -E "^\+  '[^']+': channel\("
   ```

   Nothing printed means no channel, and this step is not applicable. Each one printed goes,
   in sorted place:
   - in `apps/desktop/shared/ipc.test.ts`, the list of `names every channel exactly once`;
     and in the `optional` list of `checks every declared channel` when its request schema
     accepts `{}`, with a comment saying why it has no subject;
   - in `apps/desktop/e2e/window.desktop.test.ts`, the list written out in
     `exposes the channels the contract declares and no others`, with a comment naming the
     card and the suite that drives it.

   A push from main (`IPC_EVENTS`) is not a channel and enters neither list.

5. **List the i18n keys that may need `NOT_ELEMENT_TEXT`.** The list is in
   `apps/desktop/e2e/window.desktop.test.ts`, and only there: `search-phrases.test.ts` cites
   it. `paints every catalogue string on load` counts the `[data-i18n]` elements on load
   against `CATALOGUE_KEYS` minus that list, so a key a component translates in its own
   `render`, puts on `title` or `aria-label`, or shows only after an action breaks the count.
   The keys the branch adds:

   ```bash
   git diff origin/main -- apps/desktop/shared/i18n/catalogue.ts | grep -E "^\+  '[a-zA-Z0-9.]+',$"
   ```

   The list already covers whole families by prefix
   (`...CATALOGUE_KEYS.filter((key) => key.startsWith('terminal.'))`), so first ask whether the
   key or its first segment is on it; a key it covers needs nothing:

   ```bash
   grep -nE "'<key>'|startsWith\('<first segment>\.'\)" apps/desktop/e2e/window.desktop.test.ts
   ```

   For each key it does not cover, show where the app uses it, and read whether that is a
   `data-i18n` element present on load (a key used only in `src/main` is a native box's or a
   menu's, never an element's):

   ```bash
   grep -rn "'<key>'" apps/desktop/src --include=*.ts --include=*.html | grep -v '\.test\.ts'
   ```

   List every key that is not, as a candidate. Add a candidate to the list, with a comment
   naming the card and the test that paints it, once the strings exist; the arbiter is
   `window.desktop.test.ts` itself, run alone as in step 6, and on CI.

6. **Build, then run the file alone and judge its time.** The e2e run the built bundle in
   `apps/desktop/out`, so build everything, uncached, never with `--filter=@tyto/desktop...`
   (it skips the CLI some suites run):

   ```bash
   TURBO_FORCE=1 pnpm build 2>&1 | tail -4
   ```

   `Cached:` must read `0 cached`. Do not ask `e2e-select.mjs` which files to run: the map
   changed, and a changed map is on its run-everything list. Run the one file with the
   reporter CI uses for the budget, which counts `beforeAll` and `afterAll`, where Electron
   starts and closes; any scratch folder outside the tree works in place of `$TMPDIR`:

   ```bash
   cd apps/desktop && TYTO_E2E_DURATIONS="$TMPDIR/e2e-new-durations.json" pnpm exec vitest run --config vitest.desktop.config.ts --reporter=default --reporter=./e2e/durations-reporter.ts e2e/$S.desktop.test.ts 2>&1 | tail -12; cd ../..
   ```

   A worktree with no Electron binary of its own (`apps/desktop/node_modules/electron/dist`
   missing) reuses the main checkout's: prefix the command with
   `ELECTRON_OVERRIDE_DIST_PATH="<main checkout>/apps/desktop/node_modules/electron/dist"`.
   Then judge the time the way the `merge` job of `desktop-e2e.yml` does:

   ```bash
   node tools/repo-checks/src/e2e-budget.mjs "$TMPDIR/e2e-new-durations.json"
   ```

   The ceiling is `ceilingMs` in `tools/repo-checks/src/e2e-budget.json` (60 000 ms). A file
   over it needs a waiver there with its own `ceilingMs`, a `reason` and an owner `card`, never
   a bigger ceiling (ADR 0105). A local time is one machine's; CI's is the one judged.

7. **Check the file like the package does.** Typecheck of the e2e project, lint of the new
   file, and the harness scan:

   ```bash
   cd apps/desktop && pnpm exec tsc --noEmit -p tsconfig.e2e.json; echo "tsc exit $?"; pnpm exec eslint e2e/$S.desktop.test.ts; echo "eslint exit $?"; pnpm exec vitest run e2e/launch-isolation.test.ts 2>&1 | tail -4; cd ../..
   ```

8. **Report.** One row per step, with its command and output verbatim: the free name; the file
   written; the map entries added and the map test's tail; the IPC channels and where each
   went, or **not applicable**; the i18n candidates, or **none**; the build's `Cached:` line;
   the run's tail with the file's seconds against the 60 s ceiling, and whether it fell back
   to the main checkout's Electron; and the three checks. End with what was not done: the
   test itself (the `TODO(<KEY>)` lines), the full `test:desktop`, which CI runs on every push,
   and isolation, which this command does not measure (AGENTS.md › Desktop app and e2e: the
   real data folder's modification times before and after the run).

Never commit or push from this command, and never write the card's assertions: the skeleton is
where the author starts.
