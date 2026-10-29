import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The plugin files in a running app (TYTO-433, ADR 0151): what only the real window can say.
 *
 * The machine's `TYTO_HOME/plugin-files/` names two sources. One is `examples/plugins/`'s pack,
 * committed with its `dist/` into a `file://` repository made here, as a template repository
 * commits a release; the other is a repository that is not there. At start main syncs them,
 * starts the fetched copy in a process of its own on the bundled Node, and tells the window;
 * the template it brings is then in the picker's list, and the failed fetch is a row in the
 * problems panel that names the repository. The rules (when to sync, the search order, the
 * trust strip) are unit-tested in `src/main/plugin-files.test.ts`, `project.test.ts` and
 * `workspace.test.ts`.
 *
 * `TYTO_HOME` is a folder this suite writes and `--user-data-dir` keeps settings out of the
 * real ones (TYTO-150), so nothing here touches the machine's own `~/.tyto`.
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');

if (!existsSync(built)) {
  throw new Error(
    `${built} is missing — run \`pnpm --filter @tyto/desktop build\` before \`pnpm test:desktop\``,
  );
}

const EXAMPLE_PACK = join(
  here,
  '..',
  '..',
  '..',
  'examples',
  'plugins',
  'tyto-plugin-example-pack',
);
const AUTHOR = ['-c', 'user.name=Tyto', '-c', 'user.email=tyto@example.invalid'];

let scratch: string;
let missing: string;
let packUrl: string;
let home: string;
let app: ElectronApplication;
let page: Page;

interface Listed {
  readonly templates: readonly { readonly name: string }[];
  readonly failures: readonly {
    readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
  }[];
}

const list = (): Promise<Listed> =>
  page.evaluate(() =>
    (window as unknown as { tyto: Record<string, (body: unknown) => Promise<Listed>> }).tyto[
      'templates:list'
    ]!({}),
  );

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-plugin-files-e2e-'));
  home = join(scratch, 'home');

  const pack = join(scratch, 'repositories', 'pack');
  cpSync(EXAMPLE_PACK, pack, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', pack]);
  execFileSync('git', [...AUTHOR, '-C', pack, 'add', '.']);
  execFileSync('git', [...AUTHOR, '-C', pack, 'commit', '--quiet', '-m', 'release']);
  execFileSync('git', [...AUTHOR, '-C', pack, 'tag', 'v1']);
  missing = pathToFileURL(join(scratch, 'repositories', 'not-there')).href;
  packUrl = pathToFileURL(pack).href;

  mkdirSync(join(home, 'plugin-files'), { recursive: true });
  writeFileSync(
    join(home, 'plugin-files', 'templates.yaml'),
    [
      'version: 1',
      'templates:',
      '  aviso:',
      `    source: { git: '${packUrl}', ref: 'v1' }`,
      '  sumido:',
      `    source: { git: '${missing}', ref: 'v1' }`,
      '',
    ].join('\n'),
    'utf8',
  );

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
});

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the plugin files in the window', () => {
  it('lists the fetched template, and names the repository it could not fetch', async () => {
    await expect
      .poll(async () => (await list()).templates.map((template) => template.name), {
        timeout: 30_000,
      })
      .toContain('aviso');

    const rows = (await list()).failures.flatMap((failure) => failure.diagnostics);
    const failed = rows.find((row) => row.code === 'W_PLUGIN_FILE_FETCH');
    expect(failed?.message).toContain(missing);

    // The window heard `templates:changed` and listed the row without being asked.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            [...document.querySelectorAll('.problems__row')].map((row) => row.textContent ?? ''),
          ),
        { timeout: 15_000 },
      )
      .toEqual(expect.arrayContaining([expect.stringContaining('W_PLUGIN_FILE_FETCH')]));

    // For a person to look at: the real window, with the problems panel's row.
    const shot = process.env['TYTO_E2E_SCREENSHOT'];
    if (shot !== undefined) await page.screenshot({ path: shot });
  }, 60_000);

  it('offers an alias in the "/" menu, and refuses one named like a built-in template', async () => {
    writeFileSync(
      join(home, 'plugin-files', 'templates.yaml'),
      [
        'version: 1',
        'templates:',
        '  aviso:',
        `    source: { git: '${packUrl}', ref: 'v1' }`,
        '    configurations:',
        '      laranja: { alias: aviso-laranja }',
        // A built-in template's name until TYTO-436: refused, and the template stands.
        '      roxo: { alias: tabela-roxo }',
        // TYTO-471: a brand no started plugin's kit offers, a row at its line, the eighth.
        '      marca: { brand: nonexistent }',
        '',
      ].join('\n'),
      'utf8',
    );

    // Asked as the command asks it; the window lists again only when main says
    // `templates:changed`, so the rows below appear only if it did (TYTO-433).
    await page.evaluate(() =>
      (window as unknown as { tyto: Record<string, (body: unknown) => Promise<unknown>> }).tyto[
        'plugin-files:sync'
      ]!({ update: false }),
    );

    const rows = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.problems__row')].map((row) => row.textContent ?? ''),
      );
    await expect
      .poll(rows, { timeout: 15_000 })
      .toEqual(expect.arrayContaining([expect.stringContaining('E_TEMPLATE_ALIAS_TAKEN')]));
    expect((await rows()).some((row) => row.includes('W_PLUGIN_FILE_FETCH'))).toBe(false);
    const brand = (await rows()).find((row) => row.includes('W_BRAND_KIT_MISSING'));
    expect(brand).toMatch(/templates\.yaml:8:\d+: .*nonexistent/u);

    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await page.waitForSelector('.cm-tooltip-autocomplete', { state: 'visible', timeout: 15_000 });
    const offered = await page.evaluate(() =>
      [...document.querySelectorAll('.cm-tooltip-autocomplete .cm-completionLabel')].map(
        (label) => label.textContent ?? '',
      ),
    );
    expect(offered).toContain('aviso-laranja');
    expect(offered.filter((label) => label === 'tabela-roxo')).toHaveLength(1);

    // TYTO-467: the highlighted alias says what it stands for on its line, and the panel
    // CodeMirror opens beside it names the plugin file. Matched without the words around them,
    // which are in whichever language the machine runs.
    await page.keyboard.type('aviso-l');
    await page.waitForSelector('.cm-completionInfo', { state: 'visible', timeout: 15_000 });
    const described = await page.evaluate(() => ({
      detail:
        document.querySelector('.cm-tooltip-autocomplete li[aria-selected] .cm-completionDetail')
          ?.textContent ?? '',
      info: document.querySelector('.cm-completionInfo')?.textContent ?? '',
    }));
    // For a person to look at: the "/" menu open on the alias, with the panel beside it.
    const shot = process.env['TYTO_E2E_SCREENSHOT_ALIAS'];
    if (shot !== undefined) await page.screenshot({ path: shot });
    await page.keyboard.press('Escape');
    expect(described.detail.startsWith('aviso · laranja — ')).toBe(true);
    expect(described.info).toMatch(/aviso.*laranja.*templates\.yaml/u);

    // The same alias in "New brief from template…": the line, and the file on hover.
    await page.keyboard.press('Control+k');
    await page.waitForSelector('.command-bar__input', { state: 'visible' });
    await page.keyboard.type('document.newFromTemplate');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('.command-bar__label')].some(
          (label) => label.textContent === 'aviso-laranja',
        ),
      undefined,
      { timeout: 15_000 },
    );
    const row = await page.evaluate(() => {
      const option = [...document.querySelectorAll('.command-bar__option')].find(
        (item) => item.querySelector('.command-bar__label')?.textContent === 'aviso-laranja',
      );
      const detail = option?.querySelector('.command-bar__detail');
      return { detail: detail?.textContent ?? '', title: detail?.getAttribute('title') ?? '' };
    });
    const pickShot = process.env['TYTO_E2E_SCREENSHOT_ALIAS_PICK'];
    if (pickShot !== undefined) await page.screenshot({ path: pickShot });
    await page.keyboard.press('Escape');
    expect(row.detail).toBe('aviso · laranja');
    expect(row.title).toMatch(/aviso.*laranja.*templates\.yaml/u);
  }, 60_000);

  it('writes an alias’s configured skeleton from the "/" menu, and warns past its editor rule', async () => {
    // TYTO-440. The skeleton names `aviso`, as the entry's default would; the window writes
    // the name picked instead. Its title runs past the configuration's `max` of 10.
    writeFileSync(
      join(home, 'plugin-files', 'templates.yaml'),
      [
        'version: 1',
        'templates:',
        '  aviso:',
        `    source: { git: '${packUrl}', ref: 'v1' }`,
        '    configurations:',
        '      curto:',
        '        brief:',
        '          skeleton: |',
        '            ---',
        '            template: aviso',
        '            ---',
        '',
        '            ::titulo Inscrições abertas até sexta',
        '          editor:',
        '            titulo: { max: 10 }',
        '',
      ].join('\n'),
      'utf8',
    );
    await page.evaluate(() =>
      (window as unknown as { tyto: Record<string, (body: unknown) => Promise<unknown>> }).tyto[
        'plugin-files:sync'
      ]!({ update: false }),
    );
    await expect
      .poll(async () => (await list()).templates.map((template) => template.name), {
        timeout: 15_000,
      })
      .toContain('aviso-curto');

    // An empty brief: the "/" menu's choice writes the whole skeleton.
    await page.click('#editor .cm-content');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('/aviso-curto');
    await page.waitForSelector('.cm-tooltip-autocomplete', { state: 'visible', timeout: 15_000 });
    await page.keyboard.press('Enter');

    const text = () =>
      page.evaluate(() => document.querySelector<HTMLElement>('#editor .cm-content')?.innerText);
    await expect.poll(text, { timeout: 15_000 }).toContain('template: aviso-curto');
    expect(await text()).toContain('::titulo Inscrições abertas até sexta');

    const rows = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.problems__row')].map((row) => row.textContent ?? ''),
      );
    await expect
      .poll(rows, { timeout: 15_000 })
      .toEqual(expect.arrayContaining([expect.stringContaining('W_SLOT_OVER_CONFIGURED_LIMIT')]));
    // For a person to look at: the skeleton in the editor and the warning in the panel.
    const shot = process.env['TYTO_E2E_SCREENSHOT_SKELETON'];
    if (shot !== undefined) await page.screenshot({ path: shot });
  }, 60_000);
});
