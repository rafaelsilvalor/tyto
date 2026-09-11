import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';

import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import markSource from './__fixtures__/mark.svg?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * Step 2 and step 3 of the agent workflow in `docs/template-authoring.md`: scaffold a
 * folder, then check it. They are tested together because the pair is the claim — a
 * scaffold that `check` complains about is a scaffold that teaches an author the wrong
 * thing on their first run.
 */

let workspace: string;
let out: string[];
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: { out: (text) => out.push(text), err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    rasterizer: () => {
      throw new Error('template commands must never build a rasterizer');
    },
  };
}

const stdout = (): string => out.join('');
const stderr = (): string => errors.join('');

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-template-'));
  out = [];
  errors = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function installTemplate(name: string, markup: string = templateMarkup): Promise<string> {
  const directory = join(workspace, 'templates', name);
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(
    join(directory, 'manifest.yaml'),
    manifestSource.replace('name: cartaz', `name: ${name}`),
  );
  await writeFile(join(directory, 'template.html'), markup);
  await writeFile(join(directory, 'assets', 'mark.svg'), markSource);
  return directory;
}

/** The manifest above renders two formats, so a one-frame markup needs the second one. */
const BOTH_FRAMES = '<frame format="story" extends="feed" />\n';

/* -------------------------------------------------------------------------- check -- */

describe('tyto template check', () => {
  it('exits 0 and says so when the folder is clean', async () => {
    await installTemplate('cartaz');

    const code = await run(['template', 'check', 'templates/cartaz'], environment());

    expect(code, stderr()).toBe(EXIT_OK);
    expect(stderr()).toContain('no problems found');
  });

  it('reports a CSS property the language does not accept, at its line and column', async () => {
    await installTemplate(
      'quebrado',
      '<frame format="feed" bg="black"><rect class="a" /></frame>\n' +
        '<style>\n' +
        '  .a { z-index: 4; }\n' +
        '</style>\n',
    );

    const code = await run(['template', 'check', 'templates/quebrado'], environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    // Line 3 is where `z-index` is written, in `template.html` and not in the manifest.
    expect(stderr()).toMatch(/template\.html:3:\d+: error E_UNSUPPORTED_CSS/u);
  });

  it('stops at a manifest that does not parse, rather than burying it in markup noise', async () => {
    const directory = join(workspace, 'templates', 'torto');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'manifest.yaml'),
      'name: torto\nslots: [this is not a mapping]\n',
    );
    await writeFile(join(directory, 'template.html'), '<frame format="feed" />\n');

    const code = await run(['template', 'check', 'templates/torto'], environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toMatch(/manifest\.yaml/u);
    // The markup was never compiled, so nothing about the markup is in the output.
    expect(stderr()).not.toContain('template.html');
  });

  it('names a src= whose file really is missing, having read the ones that are there', async () => {
    await installTemplate(
      'faltando',
      '<frame format="feed" bg="black"><vector src="assets/nope.svg" /></frame>\n' + BOTH_FRAMES,
    );

    const code = await run(['template', 'check', 'templates/faltando'], environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain("no SVG file at 'assets/nope.svg'");
  });

  it('reports a folder that is not a template folder', async () => {
    const code = await run(['template', 'check', 'templates/nada'], environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain('E_INPUT_READ');
  });

  it('prints a machine-readable document under --json', async () => {
    await installTemplate('cartaz');

    const code = await run(['template', 'check', 'templates/cartaz', '--json'], environment());

    expect(code).toBe(EXIT_OK);
    expect(JSON.parse(stdout())).toEqual({ status: 'ok', diagnostics: [] });
  });
});

/* ---------------------------------------------------------------------------- new -- */

describe('tyto template new', () => {
  it('scaffolds a folder and names the files it wrote', async () => {
    const code = await run(['template', 'new', 'promo'], environment());

    expect(code, stderr()).toBe(EXIT_OK);
    expect([...(await readdir(join(workspace, 'templates', 'promo')))].sort()).toEqual([
      'manifest.yaml',
      'template.html',
    ]);
    expect(stdout()).toContain('manifest.yaml');
    expect(stdout()).toContain('template.html');
  });

  it('produces a folder that check has nothing to say about', async () => {
    // The claim the pair makes. A scaffold with a diagnostic in it teaches an author that
    // `check` cries wolf, on their very first run.
    await run(['template', 'new', 'promo', '--formats', 'feed,story'], environment());
    out = [];
    errors = [];

    const code = await run(['template', 'check', 'templates/promo'], environment());

    expect(code, stderr()).toBe(EXIT_OK);
  });

  it('refuses a name no brief could ever write, before creating anything', async () => {
    const code = await run(['template', 'new', 'nome com espaço'], environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(await readdir(join(workspace))).toEqual([]);
  });

  it('never overwrites a template that is already there', async () => {
    await run(['template', 'new', 'promo'], environment());
    const before = await readFile(join(workspace, 'templates', 'promo', 'template.html'), 'utf8');
    await writeFile(
      join(workspace, 'templates', 'promo', 'template.html'),
      '<frame format="feed" />',
    );

    const code = await run(['template', 'new', 'promo'], environment());

    expect(code).toBe(EXIT_DIAGNOSTICS);
    // The edited file is still the edited file: a second run lost nothing.
    expect(await readFile(join(workspace, 'templates', 'promo', 'template.html'), 'utf8')).not.toBe(
      before,
    );
  });
});
