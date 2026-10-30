import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS } from './exit.js';
import { run } from './program.js';
import type { LocatedDiagnostic } from './report.js';

import briefSource from './__fixtures__/cartaz.brief?raw';
import formatsSource from './__fixtures__/formats.yaml?raw';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import markSource from './__fixtures__/mark.svg?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * `environment.diagnostics` (ADR 0159 decision 7): every diagnostic a run prints, as data, with
 * the file and line the printed text names. The window turns them into Problems rows.
 */

let workspace: string;
let errors: string[];

function environment(overrides: Partial<CliEnvironment> = {}): CliEnvironment {
  return {
    console: { out: () => {}, err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    rasterizer: () => {
      throw new Error('this test rasters nothing');
    },
    ...overrides,
  };
}

/** The brief draws `./logo.png`, which this project does not have. */
const RENDER = ['render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg'];

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-sink-'));
  errors = [];
  const template = join(workspace, 'templates', 'cartaz');
  await mkdir(join(template, 'assets'), { recursive: true });
  await writeFile(join(template, 'manifest.yaml'), manifestSource);
  await writeFile(join(template, 'template.html'), templateMarkup);
  await writeFile(join(template, 'assets', 'mark.svg'), markSource);
  await writeFile(join(workspace, 'formats.yaml'), formatsSource);
  await mkdir(join(workspace, 'task'), { recursive: true });
  await writeFile(join(workspace, 'task', 'brief.brief'), briefSource);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('the diagnostics sink', () => {
  it('receives what the run printed, placed at the file and line the text names', async () => {
    const received: LocatedDiagnostic[] = [];

    const code = await run(
      RENDER,
      environment({ diagnostics: (items) => received.push(...items) }),
    );

    expect(code).toBe(EXIT_DIAGNOSTICS);
    const missing = received.find((item) => item.code === 'E_ASSET_NOT_FOUND');
    expect(missing).toMatchObject({
      severity: 'error',
      path: join('task', 'brief.brief'),
      line: 5,
      column: 1,
    });
    // The text is the same diagnostic, at the same place.
    expect(errors.join('')).toContain(
      `${join('task', 'brief.brief')}:5:1: error E_ASSET_NOT_FOUND`,
    );
  });

  it('prints exactly what a run without a sink prints', async () => {
    await run(RENDER, environment());
    const without = errors.join('');
    errors = [];

    await run(RENDER, environment({ diagnostics: () => {} }));

    expect(errors.join('')).toBe(without);
  });

  it('gives each of two runs at once its own diagnostics', async () => {
    const first: LocatedDiagnostic[] = [];
    const second: LocatedDiagnostic[] = [];

    await Promise.all([
      run(RENDER, environment({ diagnostics: (items) => first.push(...items) })),
      run(
        ['template', 'check', 'templates/nada'],
        environment({
          diagnostics: (items) => second.push(...items),
        }),
      ),
    ]);

    expect(first.map((item) => item.code)).toContain('E_ASSET_NOT_FOUND');
    expect(first.map((item) => item.code)).not.toContain('E_INPUT_READ');
    expect(second.map((item) => item.code)).toEqual(['E_INPUT_READ']);
  });
});
