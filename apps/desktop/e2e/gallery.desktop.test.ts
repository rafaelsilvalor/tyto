import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * The gallery in a running app (TYTO-504, ADR 0162): what only the real window can say.
 *
 * The `galleryIndex` setting names an index repository made here, listing one template whose
 * repository is `examples/plugins/`'s pack under another name, committed with its `dist/` and
 * tagged as a release is. A click on Install writes the machine's plugin file and syncs it, and
 * the template is then in the picker's list with no restart. A newer tag in the index is shown
 * on the card and changes nothing until Update is clicked. The rules (states, filters, what
 * each answer says) are unit-tested in `src/renderer/gallery-*.test.ts` and
 * `src/main/gallery.test.ts`.
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
/** The template's name in the gallery; no built-in or test template is called this. */
const NAME = 'galeria-teste';
/** A one-pixel PNG: the card's preview, read out of the index's commit. */
const PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let scratch: string;
let home: string;
let indexFolder: string;
let packUrl: string;
let app: ElectronApplication;
let page: Page;

function git(folder: string, ...args: string[]): void {
  execFileSync('git', [...AUTHOR, '-C', folder, ...args]);
}

function edit(path: string, change: (text: string) => string): void {
  writeFileSync(path, change(readFileSync(path, 'utf8')), 'utf8');
}

/** The index at `latest`, committed on top of what was there. */
function publish(latest: string): void {
  writeFileSync(
    join(indexFolder, 'index.yaml'),
    [
      'version: 1',
      'entries:',
      `  - id: ${NAME}`,
      '    kind: template',
      '    name: Galeria teste',
      '    description: A test template, installed from a test index.',
      `    source: { git: '${packUrl}' }`,
      `    latest: ${latest}`,
      `    templates: [${NAME}]`,
      "    engine: '>=0.1.0'",
      `    preview: previews/${NAME}.png`,
      `    changes: What ${latest} changes.`,
      '',
    ].join('\n'),
    'utf8',
  );
  git(indexFolder, 'add', '.');
  git(indexFolder, 'commit', '--quiet', '-m', latest);
}

const machineFile = (): string => readFileSync(join(home, 'plugin-files', 'gallery.yaml'), 'utf8');

const templateNames = (): Promise<readonly string[]> =>
  page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        tyto: Record<string, (body: unknown) => Promise<{ templates: { name: string }[] }>>;
      }
    ).tyto;
    return (await bridge['templates:list']!({})).templates.map((template) => template.name);
  });

/** Runs a command the way the command bar would, and fails if the window refused it. */
async function runCommand(commandId: string): Promise<void> {
  const ran = await page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the window refused '${commandId}'`);
}

const card = `.gallery__card[data-entry='${NAME}']`;

/** Opens the gallery afresh and waits for its card in `state`. */
async function openGallery(state: string): Promise<void> {
  await page.evaluate(() => {
    (document.querySelector('tyto-gallery-dialog') as { close?: () => void } | null)?.close?.();
  });
  await runCommand('gallery.show');
  await page.waitForSelector(`${card}[data-state='${state}']`, { timeout: 30_000 });
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-gallery-e2e-'));
  home = join(scratch, 'home');

  const pack = join(scratch, 'repositories', 'pack');
  cpSync(EXAMPLE_PACK, pack, { recursive: true });
  edit(join(pack, 'tyto-plugin.json'), (text) => text.replace('"example-pack"', `"${NAME}-pack"`));
  edit(join(pack, 'dist', 'index.js'), (text) =>
    text.replace("id: 'example-pack'", `id: '${NAME}-pack'`),
  );
  cpSync(join(pack, 'templates', 'aviso'), join(pack, 'templates', NAME), { recursive: true });
  rmSync(join(pack, 'templates', 'aviso'), { recursive: true, force: true });
  edit(join(pack, 'templates', NAME, 'manifest.yaml'), (text) =>
    text.replace(/^name: aviso$/mu, `name: ${NAME}`),
  );
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', pack]);
  git(pack, 'add', '.');
  git(pack, 'commit', '--quiet', '-m', 'release');
  git(pack, 'tag', 'v1');
  git(pack, 'commit', '--quiet', '--allow-empty', '-m', 'second release');
  git(pack, 'tag', 'v2');
  packUrl = pathToFileURL(pack).href;

  indexFolder = join(scratch, 'repositories', 'index');
  mkdirSync(join(indexFolder, 'previews'), { recursive: true });
  writeFileSync(join(indexFolder, 'previews', `${NAME}.png`), PICTURE);
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', indexFolder]);
  publish('v1');

  const userData = join(scratch, 'user-data');
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, 'settings.json'),
    `{\n  "galleryIndex": ${JSON.stringify(pathToFileURL(indexFolder).href)}\n}\n`,
  );

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  page = await firstWindow(app);
  await page.waitForSelector('#editor .cm-content');
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe('the gallery in the window', () => {
  it('installs a template with a click, and the template list has it without a restart', async () => {
    expect(await templateNames()).not.toContain(NAME);
    await openGallery('not installed');
    expect(await page.getAttribute(`${card} img.gallery__preview`, 'src')).toMatch(
      /^data:image\/png;base64,/u,
    );

    await page.click(`${card} .gallery__act[data-verb='install']`);
    await page.waitForSelector(`${card}[data-state='installed']`, { timeout: 30_000 });
    expect(machineFile()).toContain('ref: v1');
    await expect.poll(templateNames, { timeout: 30_000 }).toContain(NAME);
  }, 90_000);

  it('shows a newer tag and changes nothing until Update is clicked', async () => {
    publish('v2');
    await openGallery('update available');
    expect(await page.textContent(`${card} .gallery__changes`)).toContain('What v2 changes.');
    // Shown, and waiting: the file still pins the tag installed, and the template still loads.
    expect(machineFile()).toContain('ref: v1');
    expect(await templateNames()).toContain(NAME);

    // For a person to look at: the real window, with the card offering the update.
    const shot = process.env['TYTO_E2E_SCREENSHOT'];
    if (shot !== undefined) await page.screenshot({ path: shot });

    await page.click(`${card} .gallery__act[data-verb='update']`);
    await page.waitForSelector(`${card}[data-state='installed']`, { timeout: 30_000 });
    expect(machineFile()).toContain('ref: v2');
    expect(machineFile()).not.toContain('ref: v1');
    expect(await templateNames()).toContain(NAME);
  }, 90_000);
});
