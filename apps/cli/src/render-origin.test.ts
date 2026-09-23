import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS } from './exit.js';
import { builtInTemplatesDirectory } from './plugins/templates.js';
import { run } from './program.js';

/**
 * Which file a `tyto render` diagnostic says it is in.
 *
 * `templateWiring` claims a markup template's diagnostics for `template.html` as it loads
 * it, and `renderTask` then claims everything the job returned for the brief. The second
 * claim used to overwrite the first, so a broken tag on line 15 of the template printed as
 * line 15 of the brief — a position that exists, in a file that has nothing wrong with it
 * (TYTO-174, found by the template preview, which shows these paths to whoever is typing).
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
      throw new Error('an SVG render must never build a rasterizer');
    },
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-origin-'));
  out = [];
  errors = [];
  const pack = builtInTemplatesDirectory();
  await cp(join(pack, 'promo-curso'), join(workspace, 'templates', 'promo-curso'), {
    recursive: true,
  });
  await cp(join(pack, 'formats.yaml'), join(workspace, 'formats.yaml'));

  const markup = join(workspace, 'templates', 'promo-curso', 'template.html');
  const source = await readFile(markup, 'utf8');
  await writeFile(markup, source.replace('<rect id="veil"', '<rectangle id="veil"'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('tyto render on a broken markup template', () => {
  it('places the error in template.html, not in the brief', async () => {
    const brief = join('templates', 'promo-curso', 'examples', 'promo.brief');
    const code = await run(
      ['render', brief, '--out', 'out', '--types', 'svg', '--templates', 'templates', '--json'],
      environment(),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    const document = JSON.parse(out.join('')) as {
      diagnostics: { code: string; path?: string; line?: number }[];
    };
    const tag = document.diagnostics.find((item) => item.code === 'E_UNSUPPORTED_TAG');
    expect(tag, JSON.stringify(document.diagnostics)).toBeDefined();
    // Absolute, because `templateWiring` names the folder the registry found; the file is
    // what this is about.
    expect(tag!.path?.split('\\').join('/')).toMatch(/\/templates\/promo-curso\/template\.html$/);

    const markup = await readFile(
      join(workspace, 'templates', 'promo-curso', 'template.html'),
      'utf8',
    );
    const line = markup.split('\n').findIndex((text) => text.includes('<rectangle')) + 1;
    expect(tag!.line).toBe(line);
  });
});
