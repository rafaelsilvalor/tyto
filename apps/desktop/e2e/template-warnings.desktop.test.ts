import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';
import { type ElectronApplication, type Page, _electron } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeApp } from './close-app.js';
import { firstWindow } from './first-window.js';

/**
 * An installed code template's warning, in the window's Problems panel (TYTO-213, ADR 0058).
 *
 * A template's `context.report` crosses back from its plugin's process beside the frame, as
 * `ok({ frame, reports })`, and on the desktop that crossing is JSON (`plugin-wire.ts`, ADR
 * 0050) — a format that has already lost a field once. The unit and child-process tests in
 * `plugin-api` cover the protocol; this covers the desktop's own wire, end to end, with what a
 * person reads: the row, its message and its line.
 *
 * Two plugins, written here and installed by the built CLI into this suite's own `TYTO_HOME`:
 *
 * - `transborda` reports `W_TEMPLATE_OVERFLOW` on its second artwork only, so the row's line
 *   has to be the second `::lamina`'s, not the first's.
 * - `cabe` draws the same frame and reports nothing: the control, which must read "Nothing to
 *   report". Neither draws text, because a face the CI runner lacks would add a font warning
 *   that has nothing to do with this suite.
 *
 * `--user-data-dir` keeps the window's settings out of the real ones, and `closeApp` answers
 * the quit question (TYTO-150).
 */

const here = dirname(fileURLToPath(import.meta.url));
const built = join(here, '..', 'out', 'main', 'index.js');
const cli = resolve(here, '..', '..', 'cli', 'dist', 'index.js');

for (const file of [built, cli]) {
  if (!existsSync(file)) {
    throw new Error(`${file} is missing — run \`pnpm build\` before \`pnpm test:desktop\``);
  }
}

const OVERFLOW = 42;

const briefFor = (template: string): string =>
  [
    '---',
    `template: ${template}`,
    'formats: [grid-1x1]',
    '---',
    '::lamina',
    '  Primeira',
    '',
    '::lamina',
    '  Segunda',
    '',
  ].join('\n');

let scratch: string;
let home: string;
let app: ElectronApplication;
let window: Page;

function install(folder: string): void {
  const installed = spawnSync(process.execPath, [cli, 'plugin', 'install', folder, '--yes'], {
    env: { ...process.env, TYTO_HOME: home },
    encoding: 'utf8',
  });
  if (installed.status !== 0) throw new Error(`install failed: ${installed.stderr}`);
}

/**
 * Each template's own colour, so a preview says which brief it answers: the preview shows one
 * artboard at a time and both templates name their nodes alike.
 */
const COLOUR = {
  transborda: { css: '#ff5900', rgb: '{ r: 255, g: 89, b: 0, a: 1 }' },
  cabe: { css: '#0059ff', rgb: '{ r: 0, g: 89, b: 255, a: 1 }' },
} as const;

type Template = keyof typeof COLOUR;

/** A plugin with one code template of a repeatable slot, reporting on artwork 2 if asked. */
function plugin(name: Template, reports: boolean): string {
  const folder = join(scratch, 'sources', name);
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['template-pack'],
      permissions: [],
    }),
  );
  const template = join(folder, 'templates', name);
  mkdirSync(template, { recursive: true });
  writeFileSync(
    join(template, 'manifest.yaml'),
    `name: ${name}\nversion: 1.0.0\nformats: [grid-1x1]\n` +
      'slots:\n  lamina: { type: rich-text, repeat: true, min: 1 }\n',
  );
  const report = reports
    ? `if (context.artwork.index === 1) context.report({ code: 'W_TEMPLATE_OVERFLOW', overflow: ${String(OVERFLOW)} });`
    : '';
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `export function activate(host) {
  host.registerTemplatePack({
    id: '${name}', templates: [], directory: 'templates',
    build: (template, context) => {
      ${report}
      return {
        format: context.format,
        size: context.size,
        children: [{
          id: context.idPrefix + '.fundo', kind: 'rect',
          size: { w: context.size.w, h: context.size.h }, radius: [0, 0, 0, 0],
          fill: { kind: 'solid', color: ${COLOUR[name].rgb} },
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
          opacity: 1, blend: 'normal', visible: true, clip: false, effects: [],
        }],
      };
    },
  });
}
`,
  );
  return folder;
}

async function answerPicker(file: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [chosen] });
  }, file);
}

/** Runs a command the way the command bar would, and fails loudly if it was refused. */
async function run(commandId: string): Promise<void> {
  const ran = await window.evaluate((id) => {
    const bar = document.querySelector('tyto-command-bar') as {
      run?: (id: string) => boolean;
    } | null;
    return bar?.run?.(id) ?? false;
  }, commandId);
  if (!ran) throw new Error(`the command bar refused '${commandId}'`);
}

const shown = async (): Promise<string> =>
  window.evaluate(() => document.getElementById('preview-frame')?.getAttribute('srcdoc') ?? '');

/**
 * Opens the brief for `template` from disk, and waits for its preview in the template's own
 * colour, so the Problems panel below is the answer to this brief and not to the one before.
 */
async function openBrief(template: Template): Promise<void> {
  const path = join(scratch, `${template}.brief`);
  writeFileSync(path, briefFor(template), 'utf8');
  await answerPicker(path);
  await run('editor.open');
  await window.waitForFunction(
    (wanted) => document.querySelector('.cm-content')?.textContent?.includes(wanted) === true,
    `template: ${template}`,
  );
  await expect.poll(() => shown(), { timeout: 15_000 }).toContain(COLOUR[template].css);
}

interface Row {
  readonly code: string;
  readonly message: string;
  readonly where: string;
}

const rows = async (): Promise<Row[]> =>
  window.evaluate(() =>
    [...document.querySelectorAll('.problems__row')].map((row) => ({
      code: row.querySelector('.problems__code')?.textContent ?? '',
      message: row.querySelector('.problems__message')?.textContent ?? '',
      where: row.querySelector('.problems__where')?.textContent ?? '',
    })),
  );

const empty = async (): Promise<string | null> =>
  window.evaluate(() => document.querySelector('.problems__empty')?.textContent ?? null);

/** The `line:column` the panel prints for an offset, counted here from the brief's own text. */
function lineColumnOf(text: string, offset: number): string {
  const before = text.slice(0, offset).split('\n');
  return `${String(before.length)}:${String((before.at(-1)?.length ?? 0) + 1)}`;
}

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-template-warnings-'));
  home = join(scratch, 'tyto-home');
  install(plugin('transborda', true));
  install(plugin('cabe', false));

  app = await _electron.launch({
    args: ['.', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: join(here, '..'),
    env: { ...process.env, TYTO_HEADLESS: '1', TYTO_HOME: home },
  });
  window = await firstWindow(app);
  await window.waitForSelector('#editor .cm-content');
  await window.waitForSelector('.tabs__tab');
  // The plugins start after the window opens (ADR 0044); both templates are in the picker once
  // they have.
  await window.waitForFunction(
    () => {
      const picker = document.getElementById('template') as HTMLSelectElement | null;
      const values = picker === null ? [] : [...picker.options].map((option) => option.value);
      return values.includes('transborda') && values.includes('cabe');
    },
    undefined,
    { timeout: 60_000, polling: 100 },
  );
}, 180_000);

afterAll(async () => {
  await closeApp(app);
  rmSync(scratch, { recursive: true, force: true });
});

describe("an installed code template's warning in the window", () => {
  it('shows nothing to report for a template that fits', async () => {
    await openBrief('cabe');

    expect(await rows()).toEqual([]);
    expect(await empty()).toBe('Nothing to report about this brief');
  }, 60_000);

  it('lists W_TEMPLATE_OVERFLOW with the artwork, the format and the line', async () => {
    await openBrief('transborda');
    const brief = briefFor('transborda');
    const second = brief.indexOf('::lamina', brief.indexOf('::lamina') + 1);

    // By its code, not by the count: any other row is some other card's business.
    await expect
      .poll(async () => (await rows()).filter((row) => row.code === 'W_TEMPLATE_OVERFLOW'), {
        timeout: 15_000,
      })
      .toEqual([
        {
          code: 'W_TEMPLATE_OVERFLOW',
          message:
            "Artwork 'lamina-2' does not fit format 'grid-1x1': its content runs " +
            `${String(OVERFLOW)}px past the room the template has, and that part is cut.`,
          where: lineColumnOf(brief, second),
        },
      ]);
    expect(await empty()).toBeNull();
  }, 60_000);
});
