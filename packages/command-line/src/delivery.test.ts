import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * `tyto delivery new` (TYTO-489, ADR 0157 decision 5), run the way a person types it: from a
 * folder inside a workspace whose project file says where deliveries go, and from a folder in
 * no workspace at all. Every test has its own `TYTO_HOME`: none reads the machine's `~/.tyto`.
 */

let scratch: string;
let work: string;
let home: string;
let out: string[];
let errors: string[];

function environment(cwd: string): CliEnvironment {
  return {
    console: {
      out: (text) => out.push(text),
      err: (text) => errors.push(text),
    },
    version: '0.0.0-test',
    cwd,
    home,
    rasterizer: () => {
      throw new Error('a delivery renders nothing');
    },
  };
}

/** Every path under `folder`, relative with `/`, sorted. */
async function tree(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true });
  return entries.map((entry) => entry.replace(/\\/gu, '/')).sort();
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tyto-cli-delivery-'));
  work = join(scratch, 'work');
  home = join(scratch, 'home', '.tyto');
  out = [];
  errors = [];
  await mkdir(join(work, '.tyto'), { recursive: true });
  await mkdir(home, { recursive: true });
  const template = join(work, 'tpl', 'cartaz');
  await mkdir(template, { recursive: true });
  await writeFile(join(template, 'manifest.yaml'), manifestSource);
  await writeFile(join(template, 'template.html'), templateMarkup);
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('tyto delivery new', () => {
  it("makes the delivery where the project's delivery key says, with an empty brief", async () => {
    await writeFile(
      join(work, '.tyto', 'project.json'),
      '{ "delivery": { "parent": "entregas" } }',
    );
    const name = 'mca-66910_simule-sua-nota-da-2ª-fase';
    const code = await run(['delivery', 'new', name], environment(work));
    expect({ code, errors: errors.join('') }).toEqual({ code: EXIT_OK, errors: '' });
    expect(await tree(join(work, 'entregas'))).toEqual([
      name,
      `${name}/assets`,
      `${name}/editaveis`,
      `${name}/editaveis/${name}.brief`,
    ]);
    expect(await readFile(join(work, 'entregas', name, 'editaveis', `${name}.brief`), 'utf8')).toBe(
      '',
    );
    expect(out.join('')).toBe(`${join('entregas', name, 'editaveis', `${name}.brief`)}\n`);
  });

  it("starts the brief from a template's skeleton", async () => {
    await writeFile(join(work, '.tyto', 'project.json'), '{ "templates": ["tpl"] }');
    const code = await run(['delivery', 'new', 'mca-1', '--template', 'cartaz'], environment(work));
    expect({ code, errors: errors.join('') }).toEqual({ code: EXIT_OK, errors: '' });
    const brief = await readFile(join(work, 'mca-1', 'editaveis', 'mca-1.brief'), 'utf8');
    expect(brief).toMatch(/^---\ntemplate: cartaz\nformats: \[[^\]]+\]\n/u);
    // A skeleton's fields are written as their defaults: no snippet syntax reaches the file.
    expect(brief).not.toContain('${');
  });

  it('refuses a template nobody has, and makes nothing', async () => {
    const code = await run(['delivery', 'new', 'mca-1', '-t', 'nenhum'], environment(work));
    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_UNKNOWN_TEMPLATE');
    expect(await tree(work)).not.toContain('mca-1');
  });

  it('reuses an existing folder and refuses an existing brief', async () => {
    await mkdir(join(work, 'mca-1', 'assets'), { recursive: true });
    await writeFile(join(work, 'mca-1', 'assets', 'foto.png'), 'png');
    expect(await run(['delivery', 'new', 'mca-1'], environment(work))).toBe(EXIT_OK);
    expect(await tree(join(work, 'mca-1'))).toEqual([
      'assets',
      'assets/foto.png',
      'editaveis',
      'editaveis/mca-1.brief',
    ]);

    const again = await run(['delivery', 'new', 'mca-1'], environment(work));
    expect(again).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('E_DELIVERY_BRIEF_EXISTS');
  });

  it('refuses a name that cannot be a folder, and makes nothing', async () => {
    const code = await run(['delivery', 'new', 'mca:1'], environment(work));
    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(errors.join('')).toContain('W_DELIVERY_NAME_INVALID');
    expect(await tree(work)).toEqual([
      '.tyto',
      'tpl',
      'tpl/cartaz',
      'tpl/cartaz/manifest.yaml',
      'tpl/cartaz/template.html',
    ]);
  });

  it('uses the built-in layout in the current folder outside any workspace', async () => {
    const loose = join(scratch, 'loose');
    await mkdir(loose);
    expect(await run(['delivery', 'new', 'mca-1'], environment(loose))).toBe(EXIT_OK);
    expect(await tree(loose)).toEqual([
      'mca-1',
      'mca-1/assets',
      'mca-1/editaveis',
      'mca-1/editaveis/mca-1.brief',
    ]);
  });
});
