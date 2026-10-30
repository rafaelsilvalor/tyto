import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';

/**
 * `tyto render` and `tyto watch` in a folder that holds a brief and nothing else (TYTO-336).
 *
 * The window renders such a brief with the built-in pack's `formats.yaml`, and until this
 * card the command line stopped with `E_FORMATS_READ` on the same brief. The rule now is the
 * window's: the default `formats.yaml` not being there falls back to the built-in sizes; a
 * file somebody named with `--formats-file` and does not have is still an error, and so is a
 * file that is there and wrong.
 */

const TYTO_VERSION = '0.0.0-test';

/** A built-in, non-brand template in two built-in formats, and no text past its box. */
const BRIEF = `---
template: promo-curso
formats: [grid-1x1, story]
tom: laranja
---
::titulo
  Direito **Constitucional**
  Turma de setembro

::subtitulo
  Aulas ao vivo, material incluso e certificado ao final do curso.
`;

let workspace: string;
let out: string[];
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: {
      out: (text) => out.push(text),
      err: (text) => errors.push(text),
    },
    version: TYTO_VERSION,
    cwd: workspace,
    rasterizer: () => {
      throw new Error('these tests render SVG only and never raster');
    },
  };
}

/** The artworks a run wrote, by name, without `result.json` and the brief's copy. */
async function svgsIn(folder: string): Promise<string[]> {
  return (await readdir(folder)).filter((name) => name.endsWith('.svg')).sort();
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-formats-'));
  out = [];
  errors = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('tyto render in a folder with no formats.yaml', () => {
  it('writes the artworks with the built-in formats', async () => {
    await writeFile(join(workspace, 'brief.brief'), BRIEF, 'utf8');

    const code = await run(
      ['render', 'brief.brief', '--out', 'out', '--types', 'svg'],
      environment(),
    );

    expect(code, errors.join('')).toBe(EXIT_OK);
    // Both formats exist only in the built-in catalogue, so a file for each is the
    // fallback seen from outside; and nothing was said about the file nobody wrote.
    expect(await svgsIn(join(workspace, 'out'))).toEqual(['grid-1x1-01.svg', 'story-01.svg']);
    expect(errors.join('')).not.toContain('E_FORMATS_READ');
    const story = await readFile(join(workspace, 'out', 'story-01.svg'), 'utf8');
    expect(story).toMatch(/width="1080"[^>]*height="1920"/u);
  }, 60_000);

  it('still fails with E_FORMATS_READ on a --formats-file that is not there', async () => {
    await writeFile(join(workspace, 'brief.brief'), BRIEF, 'utf8');

    const code = await run(
      ['render', 'brief.brief', '--out', 'out', '--types', 'svg', '--formats-file', 'missing.yaml'],
      environment(),
    );

    // Typed and absent is a mistake, not an empty folder: falling back here would render
    // with sizes the person did not ask for and never tell them.
    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_FORMATS_READ');
    await expect(readdir(join(workspace, 'out'))).rejects.toThrow();
  });

  it('still fails on a formats.yaml that is there and broken', async () => {
    await writeFile(join(workspace, 'brief.brief'), BRIEF, 'utf8');
    await writeFile(join(workspace, 'formats.yaml'), 'grid: { w: [\n', 'utf8');

    const code = await run(
      ['render', 'brief.brief', '--out', 'out', '--types', 'svg'],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_FORMATS_SYNTAX');
  });
});

describe('tyto watch in a folder with no formats.yaml', () => {
  it('renders a task with the built-in formats', async () => {
    const task = join(workspace, 'queue', 'inbox', 'task-1');
    await mkdir(task, { recursive: true });
    await writeFile(join(task, 'brief.brief'), BRIEF, 'utf8');

    const code = await run(['watch', 'queue', '--once', '--types', 'svg'], environment());

    expect(code, errors.join('')).toBe(EXIT_OK);
    expect(errors.join('')).toBe('task-1: ok — 2 of 2 artifact(s)\n');
    expect(await svgsIn(join(workspace, 'queue', 'outbox', 'task-1', 'out'))).toEqual([
      'grid-1x1-01.svg',
      'story-01.svg',
    ]);
  }, 60_000);

  it('still fails with E_FORMATS_READ on a --formats-file that is not there', async () => {
    await mkdir(join(workspace, 'queue', 'inbox'), { recursive: true });

    const code = await run(
      ['watch', 'queue', '--once', '--types', 'svg', '--formats-file', 'missing.yaml'],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_FORMATS_READ');
  });
});
