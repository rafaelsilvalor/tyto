import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';
import { openPreviewBeside, previewSrcdoc } from './preview-pane.js';
import { waitForWindowTemplates } from './window-templates.js';

/**
 * A template's missing face, from Google Fonts on first use, in the window (TYTO-281,
 * ADR 0120, under ADR 0119's rule).
 *
 * A server of this file's own stands in for Google through `TYTO_GOOGLE_FONTS_BASE`, the
 * test-only variable main reads from its environment: **every request it receives is one the
 * window made**, so each count below is measured, and nothing reaches Google. Every other suite
 * runs with Google Fonts off (`no-google-fonts.setup.ts`); this one turns it on by name.
 *
 * The templates come from a plugin installed by the real `tyto plugin install`, PR 1's pair:
 * Syne Mono, which Google serves (the face is PR 1's fixture, read from the CLI's folder with
 * its licence beside it), Inter for a second Google face nobody has fetched, and Tyto Licensed
 * Sans, an invented family standing for a licensed one — the maintainer's machine has
 * CircularXX installed, so CircularXX would be missing nowhere here.
 *
 * Its own `--user-data-dir` and `TYTO_HOME` (TYTO-139).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');
const FACE_FILE = resolve(
  here,
  '..',
  '..',
  'cli',
  'src',
  '__fixtures__',
  'google-fonts',
  'SyneMono-Regular.ttf',
);

for (const file of [built, cli, FACE_FILE]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

const PLUGIN = 'tipos';
const ALTERNATIVES = ['Inter', 'Manrope', 'DM Sans'];
const CSS_PATH = '/css2?family=Syne+Mono:wght@400';
const FILE_PATH = '/s/synemono/v16/test.ttf';

/** Plain JavaScript with no imports: one line of text in the template's family. */
const TEMPLATE_CODE = `
const INK = { kind: 'solid', color: { r: 17, g: 17, b: 17, a: 1 } };
const PAPER = { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } };
const FAMILY = {
  'tipo-google': ['Syne Mono', 400],
  'tipo-inter': ['Inter', 400],
  'tipo-licenciado': ['Tyto Licensed Sans', 500],
};

function build(template, context) {
  const name = typeof template === 'string' ? template : template.name ?? template.manifest.name;
  const [family, weight] = FAMILY[name];
  return {
    format: context.format, size: context.size, background: PAPER,
    children: [{
      transform: { x: 60, y: 60, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
      opacity: 1, blend: 'normal', visible: true, clip: false, effects: [], kind: 'text',
      id: context.idPrefix + '.copy', box: { w: 960 },
      runs: [{ kind: 'text', text: 'Words that wrap where the face decides they wrap',
        font: { family, source: 'system' }, size: 96, weight, style: 'normal', color: INK }],
      align: 'left', valign: 'top', lineHeight: 1.2, letterSpacing: 0, overflow: 'grow',
    }],
  };
}

export function activate(host) {
  host.registerTemplatePack({ id: '${PLUGIN}', templates: [], directory: 'templates', build });
}
`;

let scratch: string;
let home: string;
let userData: string;
let app: ElectronApplication | undefined;
let page: Page;
let server: Server;
let base: string;
/** Every request the server received, as its path: one per request the window made. */
const requests: string[] = [];
const face = readFileSync(FACE_FILE);
const faceBase64 = face.toString('base64');

function install(): void {
  const folder = join(scratch, 'sources', PLUGIN);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(join(folder, 'dist', 'index.js'), TEMPLATE_CODE);
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: PLUGIN,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack'],
      permissions: [],
    }),
  );
  for (const [name, extra] of [
    ['tipo-google', ''],
    ['tipo-inter', ''],
    [
      'tipo-licenciado',
      `fonts:\n  Tyto Licensed Sans: { alternatives: [${ALTERNATIVES.join(', ')}] }\n`,
    ],
  ] as const) {
    mkdirSync(join(folder, 'templates', name), { recursive: true });
    writeFileSync(
      join(folder, 'templates', name, 'manifest.yaml'),
      `name: ${name}\nversion: 1.0.0\nformats: [grid-1x1]\nslots: {}\n${extra}`,
    );
  }
  const installed = spawnSync(process.execPath, [cli, 'plugin', 'install', folder, '--yes'], {
    env: { ...process.env, TYTO_HOME: home },
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(`install failed: ${installed.stderr}`);
}

/** Runs a command the way the command bar would, and fails loudly if it was refused. */
async function run(commandId: string): Promise<void> {
  const ran = await page.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

/** Opens `template`'s brief from disk, as File: Open does: a compile that may fetch. */
async function open(template: string): Promise<void> {
  const path = join(scratch, `${template}.brief`);
  writeFileSync(
    path,
    ['---', `template: ${template}`, 'formats: [grid-1x1]', '---', ''].join('\n'),
  );
  await app?.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, path);
  await run('editor.open');
}

const problems = async (): Promise<string> =>
  page.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map((row) => row.textContent).join('\n'),
  );

/** Waits for the preview's problems to mention `text`: the compile it belongs to answered. */
async function problemsSay(text: string): Promise<void> {
  await expect.poll(problems, { timeout: 20_000 }).toContain(text);
}

/** The setting, as a person writes it; main watches the file and applies it with no restart. */
function setGoogleFonts(on: boolean): void {
  writeFileSync(join(userData, 'settings.json'), `{\n  "googleFonts": ${String(on)}\n}\n`);
}

/**
 * Saves the Syne Mono brief until its preview embeds the fetched face or stops embedding it:
 * the sign the setting reached main. A save with the face cached asks nobody either way.
 */
async function settled(embeds: boolean): Promise<void> {
  await expect
    .poll(
      async () => {
        await run('editor.save');
        await page.waitForTimeout(500);
        return (await previewSrcdoc(page)).includes(faceBase64);
      },
      { timeout: 30_000, interval: 500 },
    )
    .toBe(embeds);
}

/** For a person to look at the real window; off in CI, where nobody would. */
async function shot(name: string): Promise<void> {
  const folder = process.env['TYTO_GOOGLE_FONTS_SHOTS'];
  if (folder !== undefined) await page.screenshot({ path: join(folder, `${name}.png`) });
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-google-fonts-e2e-'));
  home = join(scratch, 'tyto-home');
  userData = join(scratch, 'userData');
  mkdirSync(userData, { recursive: true });
  server = createServer((request, response) => {
    const path = request.url ?? '';
    requests.push(path);
    if (path === CSS_PATH) {
      response
        .writeHead(200, { 'content-type': 'text/css' })
        .end(`@font-face { src: url(${base}${FILE_PATH}) format('truetype'); }\n`);
    } else if (path === FILE_PATH) {
      response.writeHead(200, { 'content-type': 'font/ttf' }).end(face);
    } else {
      // A family Google does not have answers 400; any other face here is one we never serve.
      response.writeHead(400).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  install();

  const running = await _electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    cwd: join(here, '..'),
    env: {
      ...process.env,
      TYTO_HEADLESS: '1',
      TYTO_HOME: home,
      // By name, so `no-google-fonts.setup.ts` leaves this launch on.
      TYTO_GOOGLE_FONTS: 'on',
      TYTO_GOOGLE_FONTS_BASE: base,
    },
  });
  app = running;
  page = await firstWindow(running);
  await page.waitForSelector('#editor .cm-content');
  await page.waitForSelector('.tabs__tab');
  await openPreviewBeside(page);
  await waitForWindowTemplates(page, ['tipo-google'], 60_000);
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(scratch, { recursive: true, force: true });
});

describe('a missing face from Google Fonts in the window (ADR 0120)', () => {
  it('fetches the face when a brief is opened, draws it, and asks nothing on a second save', async () => {
    await open('tipo-google');
    await expect.poll(() => previewSrcdoc(page), { timeout: 30_000 }).toContain(faceBase64);
    // The face's two requests, the stylesheet and its file, and nothing else.
    expect(requests).toEqual([CSS_PATH, FILE_PATH]);
    expect(await problems()).not.toContain('Syne Mono');
    const cold = await previewSrcdoc(page);
    await shot('preview-google-face');

    await run('editor.save');
    await page.waitForTimeout(1_500);
    expect(requests).toHaveLength(2);
    expect(await previewSrcdoc(page)).toBe(cold);
  }, 60_000);

  it('with the setting off, asks nothing and says W_FONT_SUBSTITUTED as before', async () => {
    setGoogleFonts(false);
    // Off, the fetched face is not drawn either: the preview is what it was before the feature.
    await settled(false);
    expect(requests).toHaveLength(2);

    await open('tipo-inter');
    await problemsSay("Font 'Inter 400 normal' is not installed on this machine; drawn in");
    await run('editor.save');
    await page.waitForTimeout(1_500);
    expect(requests).toHaveLength(2);
  }, 90_000);

  it('never asks for a licensed family, and names it in the Problems panel', async () => {
    setGoogleFonts(true);
    await open('tipo-google');
    await settled(true);
    expect(requests).toHaveLength(2);

    await open('tipo-licenciado');
    await problemsSay("Font 'Tyto Licensed Sans 500' is not installed on this machine and Tyto");
    await problemsSay('Free fonts of the same kind: Inter, Manrope, DM Sans.');
    await run('editor.save');
    await page.waitForTimeout(1_500);
    expect(requests).toHaveLength(2);
    await shot('problems-font-unavailable');
  }, 90_000);
});
