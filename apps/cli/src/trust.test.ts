import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK } from './exit.js';
import { run } from './program.js';
import briefSource from './__fixtures__/cartaz.brief?raw';
import formatsSource from './__fixtures__/formats.yaml?raw';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import markSource from './__fixtures__/mark.svg?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * `tyto trust add` and `tyto trust list` (TYTO-349, ADR 0111, ADR 0112, ADR 0114).
 *
 * Every test has its own `TYTO_HOME` under a temporary folder: none reads or writes the
 * machine's `~/.tyto/trust.json`.
 */

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

const stdout = (): string => out.join('');
const stderr = (): string => errors.join('');
const trustFile = (): string => join(home, 'trust.json');

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
  scratch = await mkdtemp(join(tmpdir(), 'tyto-cli-trust-'));
  work = join(scratch, 'work');
  home = join(scratch, 'home', '.tyto');
  out = [];
  errors = [];
  await mkdir(join(work, '.tyto'), { recursive: true });
  await mkdir(home, { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('tyto trust add', () => {
  it('grants a folder, and list shows its real path and the day', async () => {
    await project('{ "output": "exports" }');
    expect(await run(['trust', 'add', 'work'], environment()), stderr()).toBe(EXIT_OK);
    const real = await realpath(work);
    expect(stdout()).toMatch(/^Trusted: .+ \(since \d{4}-\d{2}-\d{2}\)\n$/u);
    expect(stdout()).toContain(real);

    out = [];
    expect(await run(['trust', 'list'], environment())).toBe(EXIT_OK);
    expect(stdout()).toContain(`${real}  since `);
    expect(stdout()).not.toContain('(missing)');
    expect(stdout()).toContain('tyto trust remove');
  });

  it('records the target of a junction, not the link', async () => {
    await project('{}');
    // A junction on Windows, which needs no administrator; a symbolic link elsewhere.
    await symlink(work, join(scratch, 'alias'), 'junction');
    expect(await run(['trust', 'add', 'alias'], environment()), stderr()).toBe(EXIT_OK);
    const written = JSON.parse(await readFile(trustFile(), 'utf8')) as {
      trusted: { path: string }[];
    };
    expect(written.trusted.map((entry) => entry.path)).toEqual([await realpath(work)]);
  });

  it('answers "already" the second time and writes nothing more', async () => {
    await project('{}');
    expect(await run(['trust', 'add', 'work'], environment())).toBe(EXIT_OK);
    const first = await readFile(trustFile(), 'utf8');
    out = [];
    expect(await run(['trust', 'add', 'work'], environment())).toBe(EXIT_OK);
    expect(stdout()).toBe(`Already trusted: ${await realpath(work)}\n`);
    expect(await readFile(trustFile(), 'utf8')).toBe(first);
  });

  it('refuses the folder whose .tyto is TYTO_HOME, and creates no trust.json', async () => {
    const code = await run(['trust', 'add', join('home')], environment());
    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain('ADR 0112');
    expect(stderr()).toContain('Nothing was trusted');
    expect(await listed(home)).toEqual([]);
  });

  it('refuses a path that does not exist, and creates no trust.json', async () => {
    const code = await run(['trust', 'add', 'nowhere'], environment());
    expect(code).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain('no such folder or file');
    expect(await listed(home)).toEqual([]);
  });

  it('prints what the folder does restricted before it grants', async () => {
    await project('{ "output": "../out", "plugins": { "drive": {} } }');
    expect(await run(['trust', 'add', 'work'], environment())).toBe(EXIT_OK);
    // Printed against the project file, at the key, as a render prints it.
    expect(stderr()).toMatch(/project\.json:1:\d+: warning W_PROJECT_PATH_OUTSIDE/u);
    expect(stderr()).toContain('W_PROJECT_SECTIONS_WITHHELD');
    expect(stdout()).toContain('Trusted: ');

    // Trusted now: the limits it printed are gone, so a second add prints none of them.
    errors = [];
    expect(await run(['trust', 'add', 'work'], environment())).toBe(EXIT_OK);
    expect(stderr()).toBe('');
  });

  it('leaves a broken trust.json byte for byte, and list refuses it too', async () => {
    const broken = '{ "trusted": [ }\r\n// mine';
    await writeFile(trustFile(), broken);
    expect(await run(['trust', 'add', 'work'], environment())).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain('E_TRUST_FILE');
    expect(await readFile(trustFile(), 'utf8')).toBe(broken);

    errors = [];
    expect(await run(['trust', 'list'], environment())).toBe(EXIT_DIAGNOSTICS);
    expect(stderr()).toContain('E_TRUST_FILE');
  });

  it('accepts a folder with no project file, and says it has none', async () => {
    const plain = join(scratch, 'plain');
    await mkdir(plain);
    expect(await run(['trust', 'add', 'plain'], environment()), stderr()).toBe(EXIT_OK);
    expect(stdout()).toContain('has no .tyto/project.json');
    expect(stdout()).toContain(`Trusted: ${await realpath(plain)}`);
  });

  it('grants a shared profile file by its file, and points a folder at it', async () => {
    const team = join(scratch, 'team');
    await mkdir(team);
    await writeFile(join(team, 'saude.json'), '{}');
    await project('{ "profile": "../team/saude.json" }');

    expect(await run(['trust', 'add', 'work'], environment()), stderr()).toBe(EXIT_OK);
    const file = await realpath(join(team, 'saude.json'));
    expect(stdout()).toContain(`tyto trust add "${file}"`);

    out = [];
    expect(await run(['trust', 'add', join('team', 'saude.json')], environment())).toBe(EXIT_OK);
    expect(stdout()).toContain(`Trusted: ${file}`);
    // Trusted now, so the folder no longer points at it.
    out = [];
    expect(await run(['trust', 'add', 'work'], environment())).toBe(EXIT_OK);
    expect(stdout()).toBe(`Already trusted: ${await realpath(work)}\n`);
  });

  it('writes nothing for a profile inside TYTO_HOME, trusted by where it lives', async () => {
    const profile = join(home, 'profiles', 'saude');
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, 'profile.json'), '{}');
    const code = await run(
      ['trust', 'add', join('home', '.tyto', 'profiles', 'saude', 'profile.json')],
      environment(),
    );
    expect(code).toBe(EXIT_OK);
    expect(stdout()).toContain('Already trusted by where it lives');
    expect(await listed(home)).toEqual(['profiles']);
  });
});

describe('tyto trust list', () => {
  it('says so when nothing is trusted', async () => {
    expect(await run(['trust', 'list'], environment())).toBe(EXIT_OK);
    expect(stdout()).toContain('Nothing is trusted yet');
  });

  it('marks an approval whose folder is gone', async () => {
    const gone = join(scratch, 'gone');
    await mkdir(gone);
    expect(await run(['trust', 'add', 'gone'], environment())).toBe(EXIT_OK);
    const real = await realpath(gone);
    await rm(gone, { recursive: true });
    out = [];
    expect(await run(['trust', 'list'], environment())).toBe(EXIT_OK);
    expect(stdout()).toMatch(
      new RegExp(`${real.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}.*\\(missing\\)`, 'u'),
    );
  });
});

describe('tyto render after tyto trust add', () => {
  it('prints no restriction warning and writes where the project says', async () => {
    const template = join(work, 'tpl', 'cartaz');
    await mkdir(join(template, 'assets'), { recursive: true });
    await writeFile(join(template, 'manifest.yaml'), manifestSource);
    await writeFile(join(template, 'template.html'), templateMarkup);
    await writeFile(join(template, 'assets', 'mark.svg'), markSource);
    await mkdir(join(work, 'art'), { recursive: true });
    await writeFile(
      join(work, 'art', 'logo.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    await mkdir(join(work, 'briefs'), { recursive: true });
    await writeFile(join(work, 'briefs', 'cartaz.brief'), briefSource);
    await writeFile(join(scratch, 'formats.yaml'), formatsSource);
    await project('{ "templates": ["tpl"], "assets": ["art"], "output": "../outside" }');

    expect(await run(['trust', 'add', 'work'], environment())).toBe(EXIT_OK);
    expect(stderr()).toContain('W_PROJECT_PATH_OUTSIDE');

    errors = [];
    const code = await run(
      ['render', join('work', 'briefs', 'cartaz.brief'), '--types', 'svg'],
      environment(),
    );
    expect(code, stderr()).toBe(EXIT_OK);
    expect(stderr()).toBe('');
    expect(await listed(scratch, 'outside')).toContain('feed-01.svg');
  }, 60_000);
});
