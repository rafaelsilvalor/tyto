import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';

/**
 * `*italic*` through the whole command, with the fonts Tyto ships (TYTO-329, ADR 0110).
 *
 * Until this card a brief like the one below compiled without a word and then stopped at
 * export with `E_EXPORT_FONT_UNRESOLVED`, because `@tyto/fonts` had no italic. It ships one
 * now, at both weights; and a face it still lacks is reported by the compile, on the text
 * that asks for it, as `E_FONT_FACE_UNAVAILABLE`.
 */

const TYTO_VERSION = '0.0.0-test';

/** A built-in template in Source Sans 3: italic at 700 in the title, at 400 below it. */
const ITALIC_BRIEF = `---
template: promo-curso
formats: [grid-1x1]
---
::titulo
  Direito *Constitucional*

::subtitulo
  Aulas ao vivo e *material incluso*.
`;

/** A project template that draws in a weight nothing ships, so the face check has work. */
const LIGHT_MANIFEST = `name: leve
version: 1.0.0
formats: [grid-1x1]
slots:
  titulo: { type: rich-text, required: true }
`;

const LIGHT_TEMPLATE = `<frame format="grid-1x1" bg="#0c2340">
  <text slot="titulo" class="title" />
</frame>

<style>
  .title {
    x: 80;
    y: 120;
    w: 920;
    font: 300 64px/1.2 "Source Sans 3";
    color: white;
  }
</style>
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

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-italic-'));
  out = [];
  errors = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('tyto render with italic in the brief', () => {
  it('exits 0 and embeds the italic faces it drew', async () => {
    await writeFile(join(workspace, 'brief.brief'), ITALIC_BRIEF, 'utf8');

    const code = await run(
      ['render', 'brief.brief', '--out', 'out', '--types', 'svg'],
      environment(),
    );

    expect(code, errors.join('')).toBe(EXIT_OK);
    expect(errors.join('')).not.toContain('E_EXPORT_FONT_UNRESOLVED');
    expect(errors.join('')).not.toContain('E_FONT_FACE_UNAVAILABLE');

    const svgs = (await readdir(join(workspace, 'out'))).filter((name) => name.endsWith('.svg'));
    expect(svgs).toHaveLength(1);
    const svg = await readFile(join(workspace, 'out', svgs[0] ?? ''), 'utf8');
    // One `@font-face` per face drawn: the two upright ones and the two italics.
    expect(svg).toMatch(/font-weight:700;font-style:italic/u);
    expect(svg).toMatch(/font-weight:400;font-style:italic/u);
  });
});

describe('tyto render with a face nothing ships', () => {
  it('names the face and the text at compile time, and writes no file', async () => {
    const template = join(workspace, 'templates', 'leve');
    await mkdir(template, { recursive: true });
    await writeFile(join(template, 'manifest.yaml'), LIGHT_MANIFEST, 'utf8');
    await writeFile(join(template, 'template.html'), LIGHT_TEMPLATE, 'utf8');
    await writeFile(
      join(workspace, 'brief.brief'),
      '---\ntemplate: leve\nformats: [grid-1x1]\n---\n::titulo\n  Open day\n',
      'utf8',
    );

    const code = await run(
      ['render', 'brief.brief', '--out', 'out', '--types', 'svg'],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_FONT_FACE_UNAVAILABLE');
    expect(errors.join('')).toContain("Font 'Source Sans 3 300 normal'");
  });
});
