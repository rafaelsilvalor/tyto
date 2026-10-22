import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ok } from '@tyto/core';
import { USER_AGENT } from '@tyto/google-fonts';
import { installedPacks, nodeFileSystem } from '@tyto/io';
import {
  type FetchedResponse,
  type HostCapabilities,
  type LoadedPlugins,
  PLUGIN_API_VERSION,
  type Plugin,
  type TemplatePack,
  createPluginHost,
} from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  googleFontsContribution,
  googleFontsExample,
} from '../../shared/settings.js';
import { createExportService } from './export.js';
import {
  GOOGLE_FONTS_BASE,
  GOOGLE_FONTS_SWITCH,
  googleFontsOptionsFor,
  windowGoogleFonts,
} from './google-fonts.js';
import { ASK_AGAIN, type DesktopSources, NOT_FETCHED, desktopSources } from './plugin-sources.js';
import { createPreviewService } from './preview.js';
import { createProjectSources } from './project.js';
import { fileSettingsStore } from './settings-store.js';
import { windowPlugins } from './window-plugins.js';
import type { SourceTrust } from './workspace.js';

/**
 * Google Fonts in the window (TYTO-281, ADR 0120): the built-in `font-source` composed behind
 * the window's source cache, under ADR 0119's rule, and the `googleFonts` setting.
 *
 * Against the real preview and export services, with an installed template pack in process
 * whose two code templates draw one line each: Syne Mono, which Google serves, and Tyto
 * Licensed Sans, an invented family standing for a licensed one (PR 1's pair). The network is
 * a stub `HostCapabilities.fetch` that plays Google and records every request, so **each count
 * below is a request the window made**, and no request leaves the process.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
// PR 1's fixture, read from the CLI's folder with its licence beside it there.
const FACE = readFileSync(
  resolve(
    HERE,
    '..',
    '..',
    '..',
    'cli',
    'src',
    '__fixtures__',
    'google-fonts',
    'SyneMono-Regular.ttf',
  ),
);
const packDirectory = join(
  dirname(createRequire(import.meta.url).resolve('@tyto/templates/package.json')),
  'templates',
);
const BASE = 'http://127.0.0.1:9';
const ALTERNATIVES = ['Inter', 'Manrope', 'DM Sans'];
const CSS_PATH = '/css2?family=Syne+Mono:wght@400';
const FILE_PATH = '/s/synemono/v16/test.ttf';

const FAMILY: Record<string, readonly [string, number]> = {
  'tipo-google': ['Syne Mono', 400],
  'tipo-licenciado': ['Tyto Licensed Sans', 500],
};

const INK = { kind: 'solid', color: { r: 17, g: 17, b: 17, a: 1 } } as const;
const PAPER = { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } } as const;

/** One line of text in the template's family, as PR 1's CLI test draws it. */
function frameOf(name: string, context: { format: string; size: unknown; idPrefix: string }) {
  const [family, weight] = FAMILY[name] ?? ['Syne Mono', 400];
  return {
    format: context.format,
    size: context.size,
    background: PAPER,
    children: [
      {
        transform: { x: 20, y: 20, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
        opacity: 1,
        blend: 'normal',
        visible: true,
        clip: false,
        effects: [],
        kind: 'text',
        id: `${context.idPrefix}.copy`,
        box: { w: 600 },
        runs: [
          {
            kind: 'text',
            text: 'Words that wrap where the face decides they wrap',
            font: { family, source: 'system' },
            size: 40,
            weight,
            style: 'normal',
            color: INK,
          },
        ],
        align: 'left',
        valign: 'top',
        lineHeight: 1.2,
        letterSpacing: 0,
        overflow: 'grow',
      },
    ],
  };
}

/**
 * An installed pack of code templates, in process. Its `build` has the shape of the host's
 * proxy of a plugin process (`IsolatedPackBuild`), which is what `installedPacks` hands the
 * preview and the export: the template's name, the context as data, the faces shipped.
 */
const typesPlugin = {
  id: 'tipos',
  manifest: {
    name: 'tipos',
    version: '1.0.0',
    engine: `>=${PLUGIN_API_VERSION}`,
    contributes: ['template-pack'],
    permissions: [],
  },
  activate: (host) =>
    host.registerTemplatePack({
      id: 'tipos',
      templates: [],
      directory: 'templates',
      build: ((name: string, context: { format: string; size: unknown; idPrefix: string }) =>
        Promise.resolve(
          ok({ frame: frameOf(name, context), reports: [] }),
        )) as unknown as NonNullable<TemplatePack['build']>,
    }),
} satisfies Plugin;

const installed = (): LoadedPlugins => ({
  plugins: [typesPlugin],
  warnings: [],
  close: () => Promise.resolve(),
});

let scratch: string;
let home: string;
let folder: string;
let pluginFolder: string;
/** Every request the stub network received, as path and `User-Agent`. */
let requests: { readonly path: string; readonly agent: string | undefined }[];
let enabled: boolean;
let trust: SourceTrust | undefined;
/** Flipped by a test to make the network answer like one that is down. */
let down: boolean;

/** Plays Google for the one face it has; anything else is a 400, as Google answers. */
const network: HostCapabilities = {
  fetch: (url, init): Promise<FetchedResponse> => {
    const path = url.slice(BASE.length);
    requests.push({ path, agent: init.headers?.['user-agent'] });
    const answer = (status: number, body: Uint8Array): FetchedResponse => ({
      url,
      status,
      statusText: '',
      headers: {},
      body,
    });
    if (down) return Promise.resolve(answer(503, new Uint8Array()));
    if (path === CSS_PATH) {
      const css = `@font-face { font-family: 'Syne Mono'; src: url(${BASE}${FILE_PATH}) format('truetype'); }`;
      return Promise.resolve(answer(200, new TextEncoder().encode(css)));
    }
    if (path === FILE_PATH) return Promise.resolve(answer(200, new Uint8Array(FACE)));
    return Promise.resolve(answer(400, new Uint8Array()));
  },
  credential: () => Promise.resolve(undefined),
  describeCredential: () => 'no credential in this test',
};

function writeManifests(): void {
  for (const [name, extra] of [
    ['tipo-google', ''],
    [
      'tipo-licenciado',
      `fonts:\n  Tyto Licensed Sans: { alternatives: [${ALTERNATIVES.join(', ')}] }\n`,
    ],
  ] as const) {
    mkdirSync(join(pluginFolder, 'templates', name), { recursive: true });
    writeFileSync(
      join(pluginFolder, 'templates', name, 'manifest.yaml'),
      `name: ${name}\nversion: 1.0.0\nformats: [grid-1x1]\nslots: {}\n${extra}`,
    );
  }
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-desktop-google-fonts-'));
  home = join(scratch, 'home');
  folder = join(scratch, 'briefs');
  pluginFolder = join(scratch, 'tipos');
  mkdirSync(folder, { recursive: true });
  writeManifests();
  requests = [];
  enabled = true;
  trust = { trust: 'none' };
  down = false;
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The window as `index.ts` composes it, with `variables` standing for the environment. */
async function composed(variables: Record<string, string> = { [GOOGLE_FONTS_BASE]: BASE }) {
  const options = googleFontsOptionsFor(variables);
  const fileSystem = nodeFileSystem();
  const sources = await createProjectSources({ fileSystem, builtIn: packDirectory });
  const packs = await installedPacks(createPluginHost(), installed(), () => pluginFolder, {
    allowCode: true,
  });
  await sources.setInstalled(packs);
  const contributed = windowPlugins(Promise.resolve(installed()));
  await contributed.ready;
  const pluginSources: DesktopSources = desktopSources({
    home,
    assetSources: () => contributed.assetSources(),
    fontSources: () => contributed.fontSources(),
    trustFor: (directory) => Promise.resolve(directory === undefined ? undefined : trust),
    googleFonts: windowGoogleFonts({ options, capabilities: network, enabled: () => enabled }),
  });
  const preview = await createPreviewService({ fileSystem, sources, pluginSources });
  const exports_ = await createExportService({
    fileSystem,
    sources,
    version: '0.0.0-test',
    plugins: Promise.resolve(installed()),
    pluginSources,
  });
  return { preview, exports_ };
}

const brief = (template: string): string =>
  ['---', `template: ${template}`, 'formats: [grid-1x1]', '---', ''].join('\n');

const codes = (diagnostics: readonly { readonly code: string }[]): string[] =>
  diagnostics.map(({ code }) => code).filter((code) => code.startsWith('W_FONT'));

const messageOf = (diagnostics: readonly { code: string; message: string }[], code: string) =>
  diagnostics.find((item) => item.code === code)?.message;

const embedsFace = (html: string | undefined): boolean =>
  (html ?? '').includes(FACE.toString('base64'));

describe('the googleFonts setting', () => {
  it('is on by default, a boolean, and nothing else', () => {
    expect(DEFAULT_SETTINGS.googleFonts).toBe(true);
    expect(googleFontsContribution.schema.safeParse(false).success).toBe(true);
    // Where Tyto connects is never a setting's to say: an address is refused.
    expect(googleFontsContribution.schema.safeParse('http://127.0.0.1:9').success).toBe(false);
    expect(googleFontsContribution.schema.safeParse({ base: BASE }).success).toBe(false);
  });
});

describe('the googleFonts setting in settings.json', () => {
  const read = async (text: string) => {
    const file = join(scratch, 'settings.json');
    writeFileSync(file, text, 'utf8');
    return fileSettingsStore(file).load();
  };

  it('is on when the file says nothing, and off when it says false', async () => {
    expect((await read('{}\n')).settings.googleFonts).toBe(true);
    const reading = await read('{\n  "googleFonts": false\n}\n');
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.googleFonts).toBe(false);
  });

  it('refuses an address at the value, and stays on', async () => {
    const text = `{\n  "googleFonts": "${BASE}"\n}\n`;
    const reading = await read(text);
    expect(reading.settings.googleFonts).toBe(true);
    expect(reading.diagnostics.map(({ code }) => code)).toEqual(['W_SETTING_INVALID']);
  });

  it('is in a new settings.json commented out, and parses with nothing to say uncommented', async () => {
    const example = googleFontsExample();
    expect(example).toContain('// "googleFonts": true,');
    const line = example.replace('// "googleFonts"', '"googleFonts"').replace(/,$/u, '');
    const reading = await read(`{\n${line}\n}\n`);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.settings.googleFonts).toBe(true);
  });
});

describe("where the window's Google Fonts connects", () => {
  it('is Google unless the environment names a test server, and off with the switch', () => {
    expect(googleFontsOptionsFor({})).toEqual({});
    expect(googleFontsOptionsFor({ [GOOGLE_FONTS_BASE]: BASE })).toEqual({ base: BASE });
    expect(googleFontsOptionsFor({ [GOOGLE_FONTS_SWITCH]: 'off' })).toBeUndefined();
    expect(
      googleFontsOptionsFor({ [GOOGLE_FONTS_SWITCH]: 'OFF', [GOOGLE_FONTS_BASE]: BASE }),
    ).toBeUndefined();
  });
});

describe('the preview, with Google Fonts composed (ADR 0119, ADR 0120)', () => {
  it('fetches a Google face on a save, draws it, and asks nothing on the next save', async () => {
    const { preview } = await composed();

    const saved = await preview.preview(brief('tipo-google'), folder, 'save');
    expect(requests.map(({ path }) => path)).toEqual([CSS_PATH, FILE_PATH]);
    expect(requests.every(({ agent }) => agent === USER_AGENT)).toBe(true);
    expect(codes(saved.diagnostics)).toEqual([]);
    expect(embedsFace(saved.frames[0]?.html)).toBe(true);

    const again = await preview.preview(brief('tipo-google'), folder, 'save');
    expect(requests).toHaveLength(2);
    expect(again.frames[0]?.html).toBe(saved.frames[0]?.html);
  });

  it('asks a failing face once per process, and says how to ask again', async () => {
    down = true;
    const { preview } = await composed();

    for (let save = 0; save < 3; save += 1) {
      const result = await preview.preview(brief('tipo-google'), folder, 'save');
      expect(codes(result.diagnostics)).toEqual(['W_FONT_SUBSTITUTED', 'W_FONT_SOURCE_FAILED']);
      expect(messageOf(result.diagnostics, 'W_FONT_SOURCE_FAILED')).toContain(ASK_AGAIN);
    }
    expect(requests.map(({ path }) => path)).toEqual([CSS_PATH]);
  });

  it('asks nothing while typing, and says to save', async () => {
    const { preview } = await composed();

    const typed = await preview.preview(brief('tipo-google'), folder, 'typing');
    expect(requests).toEqual([]);
    expect(codes(typed.diagnostics)).toEqual(['W_FONT_SUBSTITUTED', 'W_FONT_SOURCE_FAILED']);
    expect(messageOf(typed.diagnostics, 'W_FONT_SOURCE_FAILED')).toContain(NOT_FETCHED.typing);
  });

  it.each([
    ['a restricted folder', { trust: 'restricted', open: true } as const],
    ['an unsaved buffer', undefined],
  ])('asks nothing for %s', async (_case, answer) => {
    trust = answer;
    const { preview } = await composed();
    await preview.preview(brief('tipo-google'), answer === undefined ? undefined : folder, 'save');
    expect(requests).toEqual([]);
  });

  it('never asks for a licensed family, and names it with the template’s alternatives', async () => {
    const { preview } = await composed();

    const saved = await preview.preview(brief('tipo-licenciado'), folder, 'save');
    expect(requests).toEqual([]);
    expect(codes(saved.diagnostics)).toEqual(['W_FONT_UNAVAILABLE']);
    expect(messageOf(saved.diagnostics, 'W_FONT_UNAVAILABLE')).toBe(
      "Font 'Tyto Licensed Sans 500' is not installed on this machine and Tyto cannot download " +
        "it: it is not on Google Fonts, so it is likely a licensed font. Drawn in 'Source Sans 3' " +
        'instead. Free fonts of the same kind: Inter, Manrope, DM Sans. Install ' +
        "'Tyto Licensed Sans' to render it as designed.",
    );
  });

  it('with the setting off, asks nothing and says W_FONT_SUBSTITUTED exactly as before', async () => {
    enabled = false;
    const { preview } = await composed();

    const google = await preview.preview(brief('tipo-google'), folder, 'save');
    const licensed = await preview.preview(brief('tipo-licenciado'), folder, 'save');
    expect(requests).toEqual([]);
    expect(codes(google.diagnostics)).toEqual(['W_FONT_SUBSTITUTED']);
    expect(codes(licensed.diagnostics)).toEqual(['W_FONT_SUBSTITUTED']);
    expect(embedsFace(google.frames[0]?.html)).toBe(false);
  });

  it('reads the setting on every compile: turned on, the next save fetches', async () => {
    enabled = false;
    const { preview } = await composed();
    await preview.preview(brief('tipo-google'), folder, 'save');
    expect(requests).toEqual([]);

    enabled = true;
    const saved = await preview.preview(brief('tipo-google'), folder, 'save');
    expect(requests).toHaveLength(2);
    expect(embedsFace(saved.frames[0]?.html)).toBe(true);
  });

  it('with TYTO_GOOGLE_FONTS=off, asks nothing whatever the setting says', async () => {
    const { preview } = await composed({ [GOOGLE_FONTS_SWITCH]: 'off', [GOOGLE_FONTS_BASE]: BASE });
    const saved = await preview.preview(brief('tipo-licenciado'), folder, 'save');
    expect(requests).toEqual([]);
    expect(codes(saved.diagnostics)).toEqual(['W_FONT_SUBSTITUTED']);
  });
});

describe('the export, with the same cache', () => {
  const run = (exports_: Awaited<ReturnType<typeof composed>>['exports_'], queued: boolean) =>
    exports_.run({
      brief: brief('tipo-google'),
      directory: join(folder, 'out'),
      briefDirectory: folder,
      label: 'tipo-google',
      outputs: [{ kind: 'svg' }],
      queued,
    });

  it('never fetches for a queued task, fetches from the export box, and the queue reads it after', async () => {
    const { exports_ } = await composed();

    const queued = await run(exports_, true);
    expect(requests).toEqual([]);
    expect(codes(queued.diagnostics)).toEqual(['W_FONT_SUBSTITUTED', 'W_FONT_SOURCE_FAILED']);

    const exported = await run(exports_, false);
    expect(requests).toHaveLength(2);
    expect(codes(exported.diagnostics)).toEqual([]);

    const after = await run(exports_, true);
    expect(requests).toHaveLength(2);
    expect(codes(after.diagnostics)).toEqual([]);
  });

  it('names a licensed family the same way the preview does', async () => {
    const { exports_ } = await composed();
    const result = await exports_.run({
      brief: brief('tipo-licenciado'),
      directory: join(folder, 'out'),
      briefDirectory: folder,
      label: 'tipo-licenciado',
      outputs: [{ kind: 'svg' }],
    });
    expect(requests).toEqual([]);
    expect(codes(result.diagnostics)).toEqual(['W_FONT_UNAVAILABLE']);
    expect(messageOf(result.diagnostics, 'W_FONT_UNAVAILABLE')).toContain(
      'Free fonts of the same kind: Inter, Manrope, DM Sans.',
    );
  });
});
