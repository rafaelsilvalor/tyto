import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bundledFontOutlinePath } from '@tyto/fonts';
import { fsTrustStore } from '@tyto/io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';
import { fontsFor } from './render-task.js';
import briefSource from './__fixtures__/cartaz.brief?raw';
import formatsSource from './__fixtures__/formats.yaml?raw';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import markSource from './__fixtures__/mark.svg?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * `tyto render` on a brief inside a workspace folder (TYTO-278, ADR 0111, ADR 0112).
 *
 * The workspace is found by walking up from the brief, and its `.tyto/project.json` names
 * where the template, the image and the exports are — none of them beside the brief, so a
 * render that finds them found them through the project file. Every test has its own
 * `TYTO_HOME` and its own folders: none reads the machine's `~/.tyto`.
 */

/** A real 1×1 PNG, so the asset resolver has bytes to hash and a file to find. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const PROJECT = '{ "templates": ["tpl"], "assets": ["art"], "output": "exports" }';

let scratch: string;
let work: string;
let home: string;
let out: string[];
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: {
      out: (text) => out.push(text),
      err: (text) => errors.push(text),
    },
    version: '0.0.0-test',
    cwd: scratch,
    home,
    rasterizer: () => {
      throw new Error('these tests render SVG only and never raster');
    },
  };
}

const stderr = (): string => errors.join('');
const BRIEF = join('work', 'briefs', 'cartaz.brief');

async function project(text: string): Promise<void> {
  await writeFile(join(work, '.tyto', 'project.json'), text);
}

async function listed(...segments: string[]): Promise<string[]> {
  try {
    return (await readdir(join(...segments))).sort();
  } catch {
    return [];
  }
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tyto-cli-workspace-'));
  work = join(scratch, 'work');
  home = join(scratch, 'home', '.tyto');
  out = [];
  errors = [];

  const template = join(work, 'tpl', 'cartaz');
  await mkdir(join(template, 'assets'), { recursive: true });
  await writeFile(join(template, 'manifest.yaml'), manifestSource);
  await writeFile(join(template, 'template.html'), templateMarkup);
  await writeFile(join(template, 'assets', 'mark.svg'), markSource);
  await mkdir(join(work, 'art'), { recursive: true });
  await writeFile(join(work, 'art', 'logo.png'), LOGO_PNG);
  await mkdir(join(work, 'briefs'), { recursive: true });
  await writeFile(join(work, 'briefs', 'cartaz.brief'), briefSource);
  await mkdir(join(work, '.tyto'), { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(scratch, 'formats.yaml'), formatsSource);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('tyto render inside a workspace', () => {
  it('reads the template and the image from the declared folders and writes to the output folder', async () => {
    await project(PROJECT);
    const code = await run(['render', BRIEF, '--types', 'svg'], environment());

    expect(code, stderr()).toBe(EXIT_OK);
    expect(await listed(work, 'exports')).toEqual(['feed-01.svg', 'feed-02.svg', 'result.json']);
    const svg = await readFile(join(work, 'exports', 'feed-01.svg'), 'utf8');
    expect(svg).toContain(LOGO_PNG.toString('base64'));
    // Inside its own folder a restricted workspace needs no approval, and says nothing.
    expect(stderr()).toBe('');
  }, 60_000);

  it('lets --out typed on the command line win over the declared folder', async () => {
    await project(PROJECT);
    const code = await run(
      ['render', BRIEF, '--types', 'svg', '--out', 'elsewhere'],
      environment(),
    );
    expect(code, stderr()).toBe(EXIT_OK);
    expect(await listed(scratch, 'elsewhere')).toContain('feed-01.svg');
    expect(await listed(work, 'exports')).toEqual([]);
  }, 60_000);

  it('refuses a restricted folder an output outside itself, and says why before asking for --out', async () => {
    await project('{ "templates": ["tpl"], "assets": ["art"], "output": "../outside" }');
    const code = await run(['render', BRIEF, '--types', 'svg'], environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    const said = stderr();
    expect(said).toContain('W_PROJECT_PATH_OUTSIDE');
    expect(said.indexOf('W_PROJECT_PATH_OUTSIDE')).toBeLessThan(said.indexOf('--out is required'));
    // Printed against the project file, at the key.
    expect(said).toMatch(/project\.json:1:\d+: warning W_PROJECT_PATH_OUTSIDE/u);
    expect(await listed(scratch, 'outside')).toEqual([]);
  }, 60_000);

  it('lifts the limit for one run on --trust, and writes no approval', async () => {
    await project('{ "templates": ["tpl"], "assets": ["art"], "output": "../outside" }');
    const code = await run(['render', BRIEF, '--types', 'svg', '--trust'], environment());

    expect(code, stderr()).toBe(EXIT_OK);
    expect(await listed(scratch, 'outside')).toContain('feed-01.svg');
    expect(await listed(home)).toEqual([]);
  }, 60_000);

  it('obeys an approval in trust.json', async () => {
    await project('{ "templates": ["tpl"], "assets": ["art"], "output": "../outside" }');
    await fsTrustStore({ home }).grant(work);
    const code = await run(['render', BRIEF, '--types', 'svg'], environment());

    expect(code, stderr()).toBe(EXIT_OK);
    expect(await listed(scratch, 'outside')).toContain('feed-01.svg');
  }, 60_000);

  it('prints the withheld plugin sections of a restricted folder and still renders', async () => {
    await project(
      '{ "templates": ["tpl"], "assets": ["art"], "output": "exports", "plugins": { "drive": {} } }',
    );
    const code = await run(['render', BRIEF, '--types', 'svg'], environment());

    expect(stderr()).toContain('W_PROJECT_SECTIONS_WITHHELD');
    expect(code).toBe(EXIT_OK);
    expect(await listed(work, 'exports')).toContain('feed-01.svg');
  }, 60_000);

  it('still asks for --out outside any workspace', async () => {
    await writeFile(join(scratch, 'loose.brief'), briefSource);
    const code = await run(['render', 'loose.brief', '--types', 'svg'], environment());
    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain("required option '-o, --out <dir>' not specified");
  });
});

describe('tyto trust remove', () => {
  it('takes an approval back, and says so when there was none', async () => {
    await fsTrustStore({ home }).grant(work);

    expect(await run(['trust', 'remove', 'work'], environment())).toBe(EXIT_OK);
    expect(out.join('')).toContain('No longer trusted');
    expect((await fsTrustStore({ home }).trustOf(work)).trust).toBe('restricted');

    out = [];
    expect(await run(['trust', 'remove', 'work'], environment())).toBe(EXIT_OK);
    expect(out.join('')).toContain('Not trusted, so nothing to remove');
  });
});

describe("a workspace's font folders", () => {
  it('are searched for a system face before the machine', async () => {
    // A copy of the bundled Regular, asked for as a `system` face: the machine has no such
    // file (CI's runner never does), so only the workspace folder can answer it.
    const regular = { family: 'Source Sans 3', weight: 400, style: 'normal' } as const;
    const fonts = join(work, 'fonts');
    await mkdir(fonts, { recursive: true });
    await copyFile(bundledFontOutlinePath(regular) ?? '', join(fonts, 'SourceSans3-Regular.ttf'));
    const asked = [{ font: { family: 'Source Sans 3', source: 'system' }, ...regular }] as const;

    const library = fontsFor([fonts]).fonts;
    expect(library.substitutions(asked)).toEqual([]);
    expect(fontsFor([fonts])).toBe(fontsFor([fonts]));
    expect(fontsFor([]).fonts).toBe(fontsFor(undefined).fonts);
  });
});
