import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { diagnostic } from '@tyto/core';
import type { Artifact } from '@tyto/pipeline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isInside } from './contain.js';
import { fileResources } from './file-resources.js';
import { fsInbox } from './fs-inbox.js';
import { fileTemplateAssets } from './file-template-assets.js';
import { fsOutbox, fsTaskOutput } from './fs-outbox.js';
import { nodeFileSystem } from './node-file-system.js';
import { pollSource } from './poll.js';
import type { BriefSource, BriefTask } from './ports.js';
import { parseRenderResult, renderResult } from './result.js';

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-io-unit-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** A real 1x1 PNG, so a hash is a hash of something and a data URI decodes. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function artifactOf(name: string, bytes = 'hello'): Artifact {
  return {
    name,
    artwork: 'slide-1',
    format: 'feed',
    kind: 'png',
    mime: 'image/png',
    bytes: new TextEncoder().encode(bytes),
  };
}

describe('fsInbox', () => {
  it('reports an inbox that does not exist yet as empty rather than throwing', async () => {
    // A watcher started before the folder was created should wait, not crash.
    expect(await fsInbox({ root: join(workspace, 'nope') }).pull()).toEqual([]);
  });

  it('skips a folder with no brief in it', async () => {
    await mkdir(join(workspace, 'inbox', 'half-copied'), { recursive: true });
    await mkdir(join(workspace, 'inbox', 'real'), { recursive: true });
    await writeFile(join(workspace, 'inbox', 'real', 'brief.brief'), '::titulo Oi\n');

    const tasks = await fsInbox({ root: join(workspace, 'inbox') }).pull();

    // Picking up the half-copied one would render nothing and then ack it.
    expect(tasks.map((task) => task.id)).toEqual(['real']);
  });

  it('lists tasks in a stable order whatever the filesystem felt like', async () => {
    for (const id of ['c', 'a', 'b']) {
      await mkdir(join(workspace, 'inbox', id), { recursive: true });
      await writeFile(join(workspace, 'inbox', id, 'brief.brief'), '::titulo Oi\n');
    }

    const tasks = await fsInbox({ root: join(workspace, 'inbox') }).pull();

    expect(tasks.map((task) => task.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to the task folder when there is no assets/ beside the brief', async () => {
    await mkdir(join(workspace, 'inbox', 'bare'), { recursive: true });
    await writeFile(join(workspace, 'inbox', 'bare', 'brief.brief'), '::titulo Oi\n');

    const [task] = await fsInbox({ root: join(workspace, 'inbox') }).pull();

    expect(task?.assetBase.endsWith('bare')).toBe(true);
  });
});

describe('fsOutbox', () => {
  it('creates the out/ folder the contract names', async () => {
    const sink = fsOutbox({ root: join(workspace, 'outbox') });
    await sink.open('issue-1');

    expect(await readdir(join(workspace, 'outbox', 'issue-1'))).toEqual(['out']);
  });

  it('leaves no scratch file behind after a write', async () => {
    const output = await fsOutbox({ root: join(workspace, 'outbox') }).open('issue-1');
    await output.write(artifactOf('slide-1-feed.png'));

    // The `.part` file is how a reader would be able to pick up half a PNG. It must not
    // survive the rename.
    expect(await readdir(join(workspace, 'outbox', 'issue-1', 'out'))).toEqual([
      'slide-1-feed.png',
    ]);
  });

  it('refuses to write a result.json that does not match the schema', async () => {
    const output = await fsOutbox({ root: join(workspace, 'outbox') }).open('issue-1');

    await expect(
      // The cast is the point: the document is the only thing the other side of ADR 0011
      // reads, and a shape that drifted should fail here rather than in a Jacurutu run.
      output.finish({ status: 'ok' } as never),
    ).rejects.toThrow(/does not match its schema/);
  });

  it('writes result.json last, so it never lists a file that is not there yet', async () => {
    const output = await fsOutbox({ root: join(workspace, 'outbox') }).open('issue-1');
    await output.write(artifactOf('slide-1-feed.png'));
    await output.finish(
      renderResult({
        cancelled: false,
        planned: 1,
        artifacts: [artifactOf('slide-1-feed.png')],
        diagnostics: [],
        version: '0.0.0-test',
        templates: [],
      }),
    );

    const names = await readdir(join(workspace, 'outbox', 'issue-1', 'out'));
    expect([...names].sort()).toEqual(['result.json', 'slide-1-feed.png']);
  });
});

describe('fsTaskOutput', () => {
  it('writes into exactly the folder it was given, with no out/ of its own', async () => {
    // What `tyto render --out <dir>` needs: `docs/integrations.md` writes the contract as
    // `--out <task>/out`, so the folder named on the command line *is* the out folder.
    const output = await fsTaskOutput(join(workspace, 'anywhere'));
    await output.write(artifactOf('slide-1-feed.png'));

    expect(await readdir(join(workspace, 'anywhere'))).toEqual(['slide-1-feed.png']);
  });

  it('creates the folder, so a caller does not have to mkdir before rendering', async () => {
    await fsTaskOutput(join(workspace, 'deep', 'nested', 'out'));

    expect(await readdir(join(workspace, 'deep', 'nested'))).toEqual(['out']);
  });

  it('validates result.json the same way the outbox does', async () => {
    const output = await fsTaskOutput(join(workspace, 'anywhere'));

    await expect(output.finish({ status: 'ok' } as never)).rejects.toThrow(
      /does not match its schema/,
    );
  });
});

describe('fileTemplateAssets', () => {
  /** A template folder in the shape `docs/template-authoring.md` documents. */
  async function installTemplate(): Promise<string> {
    const directory = join(workspace, 'templates', 'cartaz');
    await mkdir(join(directory, 'assets'), { recursive: true });
    await writeFile(join(directory, 'template.html'), '<frame format="feed" />');
    await writeFile(
      join(directory, 'assets', 'mark.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z"/></svg>',
    );
    await writeFile(join(directory, 'assets', 'logo.png'), PNG_1X1);
    await writeFile(join(directory, 'assets', 'source.psd'), 'not for embedding');
    return directory;
  }

  it('hands back the markup of a <vector src>, keyed the way a template writes it', async () => {
    const { assets } = await fileTemplateAssets({ base: await installTemplate() });

    expect(assets.svg?.('assets/mark.svg')).toContain('M0 0h1v1H0z');
    // A template is text and always uses forward slashes; the filesystem it ran on is the
    // one with an opinion about separators.
    expect(assets.svg?.('./assets/mark.svg')).toContain('M0 0h1v1H0z');
  });

  it('mints an AssetRef for an <image src>, hashed on the bytes', async () => {
    const { assets } = await fileTemplateAssets({ base: await installTemplate() });
    const ref = assets.image?.('assets/logo.png');

    // The path as the template wrote it, so a diagnostic says what the file says rather
    // than an absolute path from this machine.
    expect(ref?.id).toBe('assets/logo.png');
    expect(ref?.hash).toMatch(/^sha256-[0-9a-f]{64}$/u);
  });

  it('gives the exporters bytes for the ref it minted', async () => {
    const { assets, resources } = await fileTemplateAssets({ base: await installTemplate() });
    const ref = assets.image?.('assets/logo.png');
    if (ref === undefined) throw new Error('no ref was minted for assets/logo.png');

    expect(resources.html?.asset?.(ref)).toMatch(/^data:image\/png;base64,/u);
  });

  it('ignores a file no document could embed', async () => {
    const { assets } = await fileTemplateAssets({ base: await installTemplate() });

    // A `.psd` beside the logo is a working file, not an oversight to report.
    expect(assets.image?.('assets/source.psd')).toBeUndefined();
  });

  it('answers nothing for a folder that is not there, rather than throwing', async () => {
    const { assets } = await fileTemplateAssets({ base: join(workspace, 'no-such-template') });

    // A template with no `src` needs no folder. The unresolved path is `template-lang`'s
    // diagnostic to write, not this adapter's exception to throw.
    expect(assets.svg?.('assets/mark.svg')).toBeUndefined();
  });
});

describe('renderResult', () => {
  it('derives status from the diagnostics rather than trusting a caller', async () => {
    const withError = renderResult({
      cancelled: false,
      planned: 1,
      artifacts: [],
      diagnostics: [diagnostic('E_NO_TEMPLATE', {})],
      version: '1.0.0',
      templates: [],
    });

    expect(withError.status).toBe('error');
    expect(parseRenderResult(withError).ok).toBe(true);
  });

  it('calls a cancelled run ok, because nothing went wrong', async () => {
    const cancelled = renderResult({
      cancelled: true,
      planned: 12,
      artifacts: [artifactOf('slide-1-feed.png')],
      diagnostics: [],
      version: '1.0.0',
      templates: [],
    });

    // `status` answers correctness; `cancelled` and the counts answer completeness. ADR
    // 0011 fixes status at two values, so a third one is not available to say this with.
    expect(cancelled.status).toBe('ok');
    expect([cancelled.cancelled, cancelled.planned, cancelled.artifacts.length]).toEqual([
      true,
      12,
      1,
    ]);
  });

  it('keeps a diagnostic range and hint, and omits them when absent', async () => {
    const built = renderResult({
      cancelled: false,
      planned: 0,
      artifacts: [],
      diagnostics: [
        diagnostic('E_UNKNOWN_TEMPLATE', { template: 'x', available: 'y' }, { hint: 'try y' }),
      ],
      version: '1.0.0',
      templates: [],
    });

    expect(built.diagnostics[0]?.hint).toBe('try y');
    expect('range' in (built.diagnostics[0] ?? {})).toBe(false);
  });

  it('rejects a document with a key the contract does not define', async () => {
    const parsed = parseRenderResult({
      status: 'ok',
      cancelled: false,
      planned: 0,
      artifacts: [],
      diagnostics: [],
      tyto: { version: '1.0.0', templates: [] },
      surprise: true,
    });

    expect(parsed.ok).toBe(false);
  });
});

describe('fileResources', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  it('embeds a file as a data uri with the media type its extension implies', async () => {
    await mkdir(join(workspace, 'assets'), { recursive: true });
    await writeFile(join(workspace, 'assets', 'logo.png'), PNG);

    const resources = await fileResources({ base: join(workspace, 'assets') });
    const uri = resources.html?.asset?.({
      id: './logo.png',
      source: 'file',
      path: join(workspace, 'assets', 'logo.png'),
      hash: 'sha256-x',
    });

    expect(uri?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('finds the file from the reference alone when the ref carries no path', async () => {
    await mkdir(join(workspace, 'assets'), { recursive: true });
    await writeFile(join(workspace, 'assets', 'logo.png'), PNG);

    const resources = await fileResources({ base: join(workspace, 'assets') });
    const uri = resources.svg?.asset?.({ id: 'logo.png', source: 'inline', hash: 'sha256-x' });

    expect(uri?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('reads a subfolder, because assets/logos/x.png is an ordinary layout', async () => {
    await mkdir(join(workspace, 'assets', 'logos'), { recursive: true });
    await writeFile(join(workspace, 'assets', 'logos', 'deep.png'), PNG);

    const resources = await fileResources({ base: join(workspace, 'assets') });

    expect(
      resources.html?.asset?.({
        id: 'logos/deep.png',
        source: 'file',
        path: join(workspace, 'assets', 'logos', 'deep.png'),
        hash: 'sha256-x',
      }),
    ).toBeDefined();
  });

  it('ignores a file no document could embed', async () => {
    await mkdir(join(workspace, 'assets'), { recursive: true });
    await writeFile(join(workspace, 'assets', 'working.psd'), 'not an image');

    const resources = await fileResources({ base: join(workspace, 'assets') });

    // A working file beside the logo is not an oversight to report.
    expect(
      resources.html?.asset?.({
        id: 'working.psd',
        source: 'file',
        path: join(workspace, 'assets', 'working.psd'),
        hash: 'sha256-x',
      }),
    ).toBeUndefined();
  });

  it('leaves a file over the ceiling unresolved, so the exporter names it', async () => {
    await mkdir(join(workspace, 'assets'), { recursive: true });
    await writeFile(join(workspace, 'assets', 'huge.png'), Buffer.alloc(64));

    const resources = await fileResources({ base: join(workspace, 'assets'), maxBytes: 8 });

    // Undefined is E_EXPORT_ASSET_UNRESOLVED downstream, which names the asset — and
    // naming the file to shrink is the whole point of refusing it here.
    expect(
      resources.html?.asset?.({
        id: 'huge.png',
        source: 'file',
        path: join(workspace, 'assets', 'huge.png'),
        hash: 'sha256-x',
      }),
    ).toBeUndefined();
  });

  it('treats a missing folder as no assets rather than as an error', async () => {
    const resources = await fileResources({ base: join(workspace, 'nope') });

    expect(
      resources.html?.asset?.({ id: 'x.png', source: 'file', hash: 'sha256-x' }),
    ).toBeUndefined();
  });
});

describe('nodeFileSystem', () => {
  it('reads a file and lists a directory through the port', async () => {
    await mkdir(join(workspace, 'templates', 'a'), { recursive: true });
    await writeFile(join(workspace, 'templates', 'a', 'manifest.yaml'), 'name: a\n');
    const fileSystem = nodeFileSystem();

    expect(await fileSystem.readDirectory(join(workspace, 'templates'))).toEqual([
      { name: 'a', isDirectory: true },
    ]);
    expect(
      await fileSystem.readFile(fileSystem.join(workspace, 'templates', 'a', 'manifest.yaml')),
    ).toBe('name: a\n');
  });

  it('refuses a path outside its root, naming the root', async () => {
    await writeFile(join(workspace, 'secret.txt'), 'no');
    await mkdir(join(workspace, 'allowed'), { recursive: true });
    const fileSystem = nodeFileSystem({ root: join(workspace, 'allowed') });

    await expect(fileSystem.readFile(join(workspace, 'secret.txt'))).rejects.toThrow(
      /outside the permitted root/,
    );
  });

  it('allows the root itself', async () => {
    await mkdir(join(workspace, 'allowed'), { recursive: true });
    const fileSystem = nodeFileSystem({ root: join(workspace, 'allowed') });

    expect(await fileSystem.readDirectory(join(workspace, 'allowed'))).toEqual([]);
  });
});

describe('isInside', () => {
  it.each([
    ['the root itself', '/data/inbox', '/data/inbox', true],
    ['a child', '/data/inbox', '/data/inbox/task/brief.brief', true],
    ['a sibling that shares a prefix', '/data/inbox', '/data/inbox-evil/x', false],
    ['a parent', '/data/inbox', '/data', false],
    ['a climb', '/data/inbox', '/data/inbox/../../etc/passwd', false],
  ])('%s', (_label, root, path, expected) => {
    expect(isInside(root, path)).toBe(expected);
  });
});

describe('pollSource', () => {
  function sourceOf(batches: readonly (readonly BriefTask[])[]): BriefSource {
    let call = 0;
    return {
      pull: () => Promise.resolve(batches[Math.min(call++, batches.length - 1)] ?? []),
      ack: () => Promise.resolve(),
    };
  }

  const task = (id: string): BriefTask => ({
    id,
    brief: '::titulo Oi\n',
    assetBase: '/tmp',
    briefPath: `/tmp/${id}/brief.brief`,
  });

  it('handles each task and stops when the signal fires', async () => {
    const controller = new AbortController();
    const handled: string[] = [];

    await pollSource(
      sourceOf([[task('a'), task('b')]]),
      (item) => {
        handled.push(item.id);
        if (handled.length === 2) controller.abort();
        return Promise.resolve();
      },
      { intervalMs: 1, signal: controller.signal },
    );

    expect(handled).toEqual(['a', 'b']);
  });

  it('keeps going after a task throws, and reports it', async () => {
    const controller = new AbortController();
    const failures: string[] = [];
    const handled: string[] = [];

    await pollSource(
      sourceOf([[task('bad'), task('good')]]),
      (item) => {
        handled.push(item.id);
        if (handled.length === 2) controller.abort();
        // One unreadable folder must not stop a queue with nine good ones behind it.
        return item.id === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve();
      },
      {
        intervalMs: 1,
        signal: controller.signal,
        onError: (item) => failures.push(item.id),
      },
    );

    expect(handled).toEqual(['bad', 'good']);
    expect(failures).toEqual(['bad']);
  });

  it('returns immediately when the signal is already aborted', async () => {
    const handled: string[] = [];

    await pollSource(
      sourceOf([[task('a')]]),
      (item) => {
        handled.push(item.id);
        return Promise.resolve();
      },
      { intervalMs: 1, signal: AbortSignal.abort() },
    );

    expect(handled).toEqual([]);
  });
});
