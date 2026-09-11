import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadTemplateRegistry, formatCatalogue } from '@tyto/core';
import type { Rasterizer } from '@tyto/raster';
import { markupTemplateSource, runJob } from '@tyto/pipeline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileAssetResolver } from './file-assets.js';
import { fileResources } from './file-resources.js';
import { fsInbox } from './fs-inbox.js';
import { fsOutbox } from './fs-outbox.js';
import { nodeFileSystem } from './node-file-system.js';
import type { BriefTask } from './ports.js';
import { parseRenderResult, renderResult } from './result.js';

import briefSource from './__fixtures__/cartaz.brief?raw';
import manifestSource from './__fixtures__/cartaz.manifest.yaml?raw';
import templateMarkup from './__fixtures__/cartaz.html?raw';

/**
 * The acceptance criteria are about a folder, so the test is about a folder: a real
 * directory in the OS temp space, a real brief written into it, the real job run over it,
 * and the real bytes read back off the disk afterwards.
 *
 * This file composes `BriefSource` → `runJob` → `OutputSink`, which `apps/*` will do for
 * real in E6.3. Composing it here rather than shipping a runner is deliberate: ADR 0010
 * keeps composition in the apps, and a test is the one other place that has to do it in
 * order to have anything to assert.
 *
 * The `Rasterizer` is a fake, for the reason `pipeline`'s own tests give: whether a folder
 * comes out with the right files in it is not a question a browser can answer better. The
 * template draws no text, so nothing here needs the font the repo does not bundle yet.
 */

/** A real 1×1 PNG, so `fileAssetResolver` has bytes to hash and a file to find. */
const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const TYTO_VERSION = '0.0.0-test';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-io-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** `inbox/<id>/brief.brief` + `assets/logo.png`, the shape ADR 0011 fixes. */
async function dropTask(id: string, brief: string = briefSource): Promise<void> {
  const directory = join(workspace, 'inbox', id);
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'brief.brief'), brief);
  await writeFile(join(directory, 'assets', 'logo.png'), LOGO_PNG);
}

/** `templates/cartaz/{manifest.yaml,template.html}`, read through the real port. */
async function installTemplate(): Promise<void> {
  const directory = join(workspace, 'templates', 'cartaz');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'manifest.yaml'), manifestSource);
  await writeFile(join(directory, 'template.html'), templateMarkup);
}

function fakeRasterizer(failWhen?: (width: number) => boolean): Rasterizer {
  return {
    raster: (_html, options) => {
      if (failWhen?.(options.width) === true) return Promise.reject(new Error('the tab crashed'));
      return Promise.resolve(new TextEncoder().encode(`png:${String(options.width)}`));
    },
  };
}

/** One task, start to finish, exactly as a `tyto watch` would drive it (E6.3). */
async function render(
  task: BriefTask,
  options: { rasterizer?: Rasterizer } = {},
): Promise<{ ok: boolean; messages: readonly string[] }> {
  const fileSystem = nodeFileSystem();
  const loaded = await loadTemplateRegistry(fileSystem, join(workspace, 'templates'));
  if (!loaded.ok) throw new Error(loaded.error.map((item) => item.message).join('; '));
  const registry = loaded.value;

  const output = await fsOutbox({ root: join(workspace, 'outbox') }).open(task.id);

  const result = await runJob(
    { brief: task.brief, outputs: [{ kind: 'png' }, { kind: 'svg' }] },
    {
      registry,
      templates: markupTemplateSource(fileSystem, registry),
      assets: fileAssetResolver({ base: task.assetBase }),
      resources: await fileResources({ base: task.assetBase }),
      formats: formatCatalogue({ feed: { w: 1080, h: 1080 } }),
      rasterizer: options.rasterizer ?? fakeRasterizer(),
      sink: output,
    },
  );

  await output.finish(
    renderResult({
      cancelled: result.ok ? result.value.cancelled : false,
      planned: result.ok ? result.value.planned : 0,
      artifacts: result.ok ? result.value.artifacts : [],
      diagnostics: result.ok ? result.warnings : result.error,
      version: TYTO_VERSION,
      templates: registry.list().map((entry) => ({ name: entry.name, version: entry.version })),
    }),
  );

  // The messages come back so a failing assertion says *why* the job failed instead of
  // only that it did.
  return {
    ok: result.ok,
    messages: (result.ok ? result.warnings : result.error).map((item) => item.message),
  };
}

async function outFiles(id: string): Promise<readonly string[]> {
  const names = await readdir(join(workspace, 'outbox', id, 'out'));
  return [...names].sort();
}

async function resultOf(id: string): Promise<unknown> {
  return JSON.parse(await readFile(join(workspace, 'outbox', id, 'out', 'result.json'), 'utf8'));
}

/* ------------------------------------------------------------------------- the ACs -- */

describe('a task folder dropped into the inbox', () => {
  beforeEach(async () => {
    await installTemplate();
    await dropTask('issue-42');
  });

  it('is listed by the source with its brief already read', async () => {
    const tasks = await fsInbox({ root: join(workspace, 'inbox') }).pull();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe('issue-42');
    expect(tasks[0]?.brief).toContain('template: cartaz');
    // `assets/` beside the brief is the base, because that is where Jacurutu puts an
    // issue's attachments.
    expect(tasks[0]?.assetBase.endsWith('assets')).toBe(true);
  });

  it('becomes an out/ folder with the artifacts and a result.json', async () => {
    const [task] = await fsInbox({ root: join(workspace, 'inbox') }).pull();
    if (task === undefined) throw new Error('the inbox listed nothing');

    const { ok, messages } = await render(task);
    expect(ok, messages.join('; ')).toBe(true);

    // Two slides × one format × two encodings, plus the manifest.
    expect(await outFiles('issue-42')).toEqual([
      'result.json',
      'slide-1-feed.png',
      'slide-1-feed.svg',
      'slide-2-feed.png',
      'slide-2-feed.svg',
    ]);
  });

  it('writes a result.json the schema accepts', async () => {
    const [task] = await fsInbox({ root: join(workspace, 'inbox') }).pull();
    if (task === undefined) throw new Error('the inbox listed nothing');
    await render(task);

    const parsed = parseRenderResult(await resultOf('issue-42'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));

    expect(parsed.value.status).toBe('ok');
    expect(parsed.value.cancelled).toBe(false);
    expect(parsed.value.planned).toBe(4);
    expect(parsed.value.artifacts).toHaveLength(4);
    // Sizes, not just names: a zero-byte file would satisfy a listing and nothing else.
    expect(parsed.value.artifacts.every((artifact) => artifact.bytes > 0)).toBe(true);
    // The template's own version, so a reader can tell which one produced this.
    expect(parsed.value.tyto).toEqual({
      version: TYTO_VERSION,
      templates: [{ name: 'cartaz', version: '2.1.0' }],
    });
  });

  it('carries a warning through to result.json without failing the run', async () => {
    const [task] = await fsInbox({ root: join(workspace, 'inbox') }).pull();
    if (task === undefined) throw new Error('the inbox listed nothing');
    await render(task);

    const parsed = parseRenderResult(await resultOf('issue-42'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));

    // `subtitulo` is set by the brief and mentioned by no part of the template. ADR 0013:
    // a warning rides the ok branch.
    expect(parsed.value.status).toBe('ok');
    const unused = parsed.value.diagnostics.filter((item) => item.code === 'W_UNUSED_SLOT');
    expect(unused.map((item) => item.message)).toEqual([
      "Slot 'subtitulo' is set in the brief but template 'cartaz' does not use it.",
    ]);

    // And `cor` is not among them: the stylesheet branches on it to pick the background,
    // so a brief that sets it changed the artwork (TYTO-63).
    expect(unused.some((item) => item.message.includes("'cor'"))).toBe(false);
  });

  it('resolves the asset against the task folder and hashes its bytes', async () => {
    const resolver = fileAssetResolver({ base: join(workspace, 'inbox', 'issue-42', 'assets') });
    const asset = await resolver.resolve('./logo.png');

    expect(asset?.id).toBe('./logo.png');
    // sha256 of the 1×1 PNG above. Content, not path or mtime: replacing the logo with a
    // different one under the same name has to change this.
    expect(asset?.hash).toMatch(/^sha256-[0-9a-f]{64}$/u);
  });

  it('refuses an asset that climbs out of the task folder', async () => {
    await writeFile(join(workspace, 'secret.txt'), 'not for embedding');
    const resolver = fileAssetResolver({ base: join(workspace, 'inbox', 'issue-42', 'assets') });

    expect(await resolver.resolve('../../../secret.txt')).toBeUndefined();
  });
});

describe('a task that failed', () => {
  beforeEach(async () => {
    await installTemplate();
    await dropTask('issue-99');
  });

  it('writes status error and is never acked', async () => {
    const inbox = fsInbox({ root: join(workspace, 'inbox') });
    const [task] = await inbox.pull();
    if (task === undefined) throw new Error('the inbox listed nothing');

    const { ok } = await render(task, { rasterizer: fakeRasterizer(() => true) });
    expect(ok).toBe(false);

    const parsed = parseRenderResult(await resultOf('issue-99'));
    if (!parsed.ok) throw new Error(parsed.error.join('; '));
    expect(parsed.value.status).toBe('error');
    expect(parsed.value.diagnostics.some((item) => item.code === 'E_RENDER_FAILED')).toBe(true);

    // The folder stays put (ADR 0008: never ack on error), so a person can fix the brief
    // and let it run again. Asserted by not calling `ack` and looking.
    expect(await readdir(join(workspace, 'inbox'))).toEqual(['issue-99']);

    // And the two frames that did work are still on disk beside the failure.
    expect(await outFiles('issue-99')).toEqual([
      'result.json',
      'slide-1-feed.svg',
      'slide-2-feed.svg',
    ]);
  });
});

describe('ack', () => {
  it('moves the folder out of the inbox rather than deleting it', async () => {
    await installTemplate();
    await dropTask('issue-7');
    const inbox = fsInbox({ root: join(workspace, 'inbox') });

    await inbox.ack('issue-7');

    expect(await readdir(join(workspace, 'inbox'))).toEqual([]);
    // A render that produced the wrong thing is one somebody will want to look at again.
    expect(await readdir(join(workspace, 'done', 'issue-7'))).toContain('brief.brief');
  });

  it('leaves nothing behind for the next pull', async () => {
    await installTemplate();
    await dropTask('issue-7');
    const inbox = fsInbox({ root: join(workspace, 'inbox') });

    await inbox.ack('issue-7');

    expect(await inbox.pull()).toEqual([]);
  });
});
