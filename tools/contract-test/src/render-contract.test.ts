import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { EXIT_DIAGNOSTICS, EXIT_OK } from '@tyto/io';
// `ajv/dist/2020` and not `ajv`: the default entry point speaks draft-07, and the schema
// this repository publishes declares 2020-12 — which is what Zod emits. The default build
// fails with "no schema with key or ref …/2020-12/schema", which is a useful reminder that
// a validator has to be told which dialect it is reading.
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The ADR 0011 contract, checked the way the program on the other side of it would.
 *
 * Everything else in this repository tests Tyto from inside: `apps/cli`'s suite calls
 * `run(argv, environment)` in process with a buffer for a terminal. That is the right test
 * for the CLI and the wrong one for a contract, because a consumer does not import
 * anything — it **spawns a binary, reads an exit code and parses a file**. So this one does
 * that, and validates the file against the schema this repository publishes rather than
 * against the Zod schema that produced it.
 *
 * `--types svg` on purpose: the contract is about `result.json`, the folder and the exit
 * code, and SVG exercises all three with no browser. Pixels are `@tyto/raster`'s subject.
 */

/**
 * Each test spawns the CLI and waits for it (TYTO-787). With an empty home a render takes about
 * 0.7 s on an idle machine, but on CI's `check` job, which runs every package's typecheck,
 * lint, tests and build at once, the same test was measured at 3.1–6.0 s across six commits that
 * did not touch the render path, and failed at Vitest's default of 5 s. Over three times the
 * worst measured.
 */
const SPAWN_TIMEOUT_MS = 20_000;

const CLI = fileURLToPath(new URL('../../../apps/cli/dist/index.js', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixture', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../../docs/render-result.schema.json', import.meta.url));

/** A real 1×1 PNG. Written at test time rather than committed, so the fixture stays text. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const run = promisify(execFile);

let workspace: string;
let validate: ValidateFunction;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-contract-'));
  await cp(FIXTURE, workspace, { recursive: true });
  // Created here rather than committed: Git does not version an empty directory, and the
  // only thing in it is the binary below.
  await mkdir(join(workspace, 'task', 'assets'), { recursive: true });
  await mkdir(join(workspace, 'home'), { recursive: true });
  await writeFile(join(workspace, 'task', 'assets', 'logo.png'), LOGO_PNG);

  const ajv = new Ajv2020({ strict: false });
  validate = ajv.compile(JSON.parse(await readFile(SCHEMA, 'utf8')));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawns the binary. A non-zero exit rejects, so the code is read off the error.
 *
 * With a `TYTO_HOME` of its own, empty (TYTO-787): a consumer's machine is not the one running
 * this test, and without it the binary loaded every plugin installed in the runner's real home —
 * about 4 s a render on a machine with the house's plugins, against 0.7 s with an empty one,
 * which put each test past the 5 s limit.
 */
async function tyto(...args: readonly string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
      cwd: workspace,
      env: { ...process.env, TYTO_HOME: join(workspace, 'home') },
    });
    return { code: EXIT_OK, stdout, stderr };
  } catch (cause) {
    const failure = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? -1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

async function resultOf(...segments: string[]): Promise<unknown> {
  return JSON.parse(await readFile(join(workspace, ...segments, 'result.json'), 'utf8'));
}

/** Ajv reports through the validator, so a failure has to be turned into a message. */
function expectValid(document: unknown): void {
  const valid = validate(document);
  expect(
    valid,
    `result.json does not match docs/render-result.schema.json: ${JSON.stringify(
      validate.errors,
      null,
      2,
    )}`,
  ).toBe(true);
}

describe('a task folder rendered by the binary', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('exits 0 and writes the folder the contract describes', async () => {
    const { code, stderr } = await tyto(
      'render',
      'task/brief.brief',
      '--out',
      'task/out',
      '--types',
      'svg',
    );

    expect(code, stderr).toBe(EXIT_OK);
    expect([...(await readdir(join(workspace, 'task', 'out')))].sort()).toEqual([
      'feed-01.svg',
      'feed-02.svg',
      'result.json',
    ]);
  });

  it('writes a result.json the published JSON Schema accepts', async () => {
    await tyto('render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg');

    const document = await resultOf('task', 'out');
    expectValid(document);

    const result = document as { status: string; planned: number; artifacts: unknown[] };
    expect(result.status).toBe('ok');
    expect(result.planned).toBe(2);
    expect(result.artifacts).toHaveLength(2);
  });

  it('names every artifact it wrote, with a size that is not zero', async () => {
    await tyto('render', 'task/brief.brief', '--out', 'task/out', '--types', 'svg');

    const { artifacts } = (await resultOf('task', 'out')) as {
      artifacts: readonly { name: string; bytes: number }[];
    };
    const onDisk = [...(await readdir(join(workspace, 'task', 'out')))].sort();

    expect(artifacts.map((artifact) => artifact.name).sort()).toEqual(
      onDisk.filter((name) => name !== 'result.json'),
    );
    expect(artifacts.every((artifact) => artifact.bytes > 0)).toBe(true);
  });
});

describe('a task that fails', { timeout: SPAWN_TIMEOUT_MS }, () => {
  beforeEach(async () => {
    await writeFile(
      join(workspace, 'task', 'bad.brief'),
      '---\ntemplate: naoexiste\n---\n::slide\n  Um\n',
    );
  });

  it('exits 1 and still writes a result.json the schema accepts', async () => {
    // The half a consumer depends on most: a failed run has to say so in the one file the
    // consumer is watching for, in the shape it was promised.
    const { code } = await tyto('render', 'task/bad.brief', '--out', 'task/bad', '--types', 'svg');

    expect(code).toBe(EXIT_DIAGNOSTICS);

    const document = await resultOf('task', 'bad');
    expectValid(document);

    const result = document as {
      status: string;
      artifacts: unknown[];
      diagnostics: readonly { code: string; severity: string }[];
    };
    expect(result.status).toBe('error');
    expect(result.artifacts).toEqual([]);
    expect(result.diagnostics.some((item) => item.code === 'E_UNKNOWN_TEMPLATE')).toBe(true);
    expect(result.diagnostics.every((item) => ['error', 'warning'].includes(item.severity))).toBe(
      true,
    );
  });
});

describe('what the contract says about the command line', { timeout: SPAWN_TIMEOUT_MS }, () => {
  it('exits 1 for a flag that does not exist, and writes no result.json', async () => {
    // Documented: a refused command line is exit 1 because the same invocation will fail
    // again, and no run started, so there is nothing to report in a file.
    const { code } = await tyto('render', 'task/brief.brief', '--nope');

    expect(code).toBe(EXIT_DIAGNOSTICS);
    await expect(readdir(join(workspace, 'task', 'out'))).rejects.toThrow();
  });

  it('documents --help for every flag this test relies on', async () => {
    const { stdout } = await tyto('render', '--help');

    for (const flag of ['--out', '--types', '--templates', '--formats-file']) {
      expect(stdout).toContain(flag);
    }
  });
});
