import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

/**
 * What a plugin prints never reaches the stdout of the process that started it (TYTO-565).
 *
 * `tyto mcp` speaks its protocol on stdout, one JSON-RPC message per line, and `tyto render
 * --json` prints one document there. A plugin's `console.log` landing on that stream breaks
 * both. Only a real parent can show where a child's stdout goes, because a Vitest worker's own
 * stdout is not something a test can read: so the parent is a small program bundled from this
 * folder's `plugin-process.ts`, started as its own Node process, and its two streams are read.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MARK = 'PLUGIN-WROTE-THIS';

let root: string;
/** Folders to remove after each test, besides {@link root}. */
const cleanups: string[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-plugin-stdout-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  for (const folder of cleanups.splice(0)) await rm(folder, { recursive: true, force: true });
});

/** The parent: starts one plugin through `pluginProcessLauncher`, connects it, closes it. */
const PARENT = `
import { join } from 'node:path';
import { connectIsolatedPlugin } from '@tyto/plugin-api';
import { pluginCapabilities } from './capabilities.ts';
import { pluginProcessLauncher } from './plugin-process.ts';

const [guest, directory] = process.argv.slice(2);
const launch = pluginProcessLauncher({ guest });
const connected = await connectIsolatedPlugin({
  name: 'texto',
  manifest: { name: 'texto', version: '1.0.0', engine: '>=0.1', contributes: ['exporter'], permissions: [] },
  channel: launch({ name: 'texto', entry: join(directory, 'index.js'), directory }),
  requireSandbox: true,
  onCrash: () => undefined,
  capabilities: pluginCapabilities({}),
});
if (!connected.ok) throw new Error(connected.error[0]?.message);
await connected.value.close();
process.stderr.write('parent: closed\\n');
`;

/**
 * Inside this package's `node_modules`, so the program's bare imports resolve there as the
 * package's own do. A folder in the OS temp space has no `node_modules` above it.
 */
async function programFolder(): Promise<string> {
  const parent = join(HERE, '..', '..', 'node_modules', '.tyto-test');
  await mkdir(parent, { recursive: true });
  return mkdtemp(join(parent, 'plugin-stdout-'));
}

async function parentProgram(): Promise<string> {
  const folder = await programFolder();
  cleanups.push(folder);
  const outfile = join(folder, 'parent.mjs');
  await build({
    stdin: { contents: PARENT, resolveDir: HERE, loader: 'ts', sourcefile: 'parent.ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile,
    logLevel: 'silent',
    // Only this folder's source is bundled; every package is imported from `node_modules`,
    // which Node finds by walking up from the program (see {@link programFolder}).
    packages: 'external',
  });
  return outfile;
}

function runParent(
  program: string,
  directory: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [program, inject('pluginGuest'), directory], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

describe("a plugin's console", () => {
  // Bundles a program and starts two processes, which a loaded machine can hold past 5 s.
  it("goes to the parent's stderr, never to its stdout", async () => {
    const directory = join(root, 'texto');
    await mkdir(directory);
    await writeFile(
      join(directory, 'index.js'),
      `console.log('${MARK} at import');
export function activate(host) {
  process.stdout.write('${MARK} in activate\\n');
  host.registerExporter({
    id: 'texto', mime: 'text/plain', extension: 'txt', kinds: ['txt'], rasterized: false,
    exportFrame: () => ({ ok: true, value: '', diagnostics: [] }),
  });
}
`,
    );

    const result = await runParent(await parentProgram(), directory);

    expect(result.stdout).not.toContain(MARK);
    // The control: the plugin ran and printed, and the parent got as far as closing it.
    expect(result.stderr).toContain(`${MARK} at import`);
    expect(result.stderr).toContain(`${MARK} in activate`);
    expect(result.stderr).toContain('parent: closed');
    expect(result.code).toBe(0);
  }, 60_000);
});
