import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Diagnostics } from '@tyto/core';
import type { Artifact } from '@tyto/pipeline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type DeliveryOutput,
  EDITABLE_DIR,
  RESULT_FILE,
  fsDeliveryOutput,
  fsTaskOutput,
} from './fs-outbox.js';
import type { ReusableTaskOutput } from './fs-outbox.js';
import { renderResult } from './result.js';

/** The delivery output, or a failed test naming why it could not be opened. */
async function openDelivery(...args: Parameters<typeof fsDeliveryOutput>): Promise<DeliveryOutput> {
  const opened = await fsDeliveryOutput(...args);
  if (!opened.ok) throw new Error(opened.error.map((item) => item.message).join('\n'));
  return opened.value;
}

/**
 * ADR 0054: a reused folder loses what Tyto wrote there last time and did not write this
 * time — and nothing else.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-io-leftovers-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const BRIEF = new TextEncoder().encode('::titulo Oi\n');

function artifactOf(name: string, bytes = `bytes of ${name}`): Artifact {
  return {
    name,
    artwork: 'lamina-1',
    format: 'grid',
    kind: 'svg',
    mime: 'image/svg+xml',
    bytes: new TextEncoder().encode(bytes),
  };
}

interface Export {
  readonly names: readonly string[];
  /** Fewer than `names.length` makes the run incomplete. */
  readonly planned?: number;
  readonly failed?: boolean;
}

/** One export through `output`, the way `render-task.ts` drives it. */
async function exportInto(output: ReusableTaskOutput, run: Export): Promise<Diagnostics> {
  const artifacts = run.names.map((name) => artifactOf(name));
  for (const artifact of artifacts) await output.write(artifact);
  const warnings = await output.removeLeftovers({
    artifacts,
    planned: run.planned ?? artifacts.length,
    cancelled: false,
    failed: run.failed ?? false,
  });
  await output.finish(
    renderResult({
      cancelled: false,
      planned: run.planned ?? artifacts.length,
      artifacts,
      diagnostics: warnings,
      version: '0.0.0-test',
      templates: [],
    }),
  );
  return warnings;
}

const delivery = (): Promise<ReusableTaskOutput> =>
  openDelivery(join(workspace, 'entregas'), { name: 'campanha', brief: BRIEF });

const folder = (): string => join(workspace, 'entregas', 'campanha');

async function artwork(): Promise<string[]> {
  return (await readdir(folder())).filter((name) => name !== EDITABLE_DIR).sort();
}

const codes = (warnings: Diagnostics): string[] =>
  warnings.map((item) => `${item.code} ${item.message}`);

/** A `result.json` as an older Tyto would have left it, written straight to disk. */
async function previousResult(artifacts: readonly { name: string; bytes: number }[]) {
  await mkdir(join(folder(), EDITABLE_DIR), { recursive: true });
  await writeFile(
    join(folder(), EDITABLE_DIR, RESULT_FILE),
    JSON.stringify({
      status: 'ok',
      cancelled: false,
      planned: artifacts.length,
      artifacts: artifacts.map((artifact) => ({
        artwork: 'lamina-1',
        format: 'grid',
        kind: 'png',
        mime: 'image/png',
        ...artifact,
      })),
      diagnostics: [],
      tyto: { version: '0.1.0', templates: [] },
    }),
  );
}

describe('a delivery folder that is exported into again', () => {
  it('removes the slide a carousel no longer has, and says so', async () => {
    await exportInto(await delivery(), { names: ['grid-01.svg', 'grid-02.svg', 'grid-03.svg'] });

    const warnings = await exportInto(await delivery(), { names: ['grid-01.svg', 'grid-02.svg'] });

    expect(await artwork()).toEqual(['grid-01.svg', 'grid-02.svg']);
    expect(codes(warnings)).toEqual([
      "W_LEFTOVER_REMOVED Removed 'grid-03.svg', which the previous export wrote and this one did not produce.",
    ]);
    // In the report the next reader opens, not only in this process's return value.
    const written = JSON.parse(
      await readFile(join(folder(), EDITABLE_DIR, RESULT_FILE), 'utf8'),
    ) as { diagnostics: { code: string }[]; status: string };
    expect(written.diagnostics.map((item) => item.code)).toEqual(['W_LEFTOVER_REMOVED']);
    expect(written.status).toBe('ok');
  });

  it('removes the files an export from before ADR 0053 named, when it now writes new names', async () => {
    // The upgrade, as the measured folder in ADR 0053 has it: the old report lists the old
    // names, and the new export writes different ones.
    await mkdir(folder(), { recursive: true });
    await writeFile(join(folder(), 'lamina-1-grid.png'), 'old one');
    await writeFile(join(folder(), 'lamina-2-grid.png'), 'old two');
    await previousResult([
      { name: 'lamina-1-grid.png', bytes: 'old one'.length },
      { name: 'lamina-2-grid.png', bytes: 'old two'.length },
    ]);

    const warnings = await exportInto(await delivery(), { names: ['grid-01.png', 'grid-02.png'] });

    expect(await artwork()).toEqual(['grid-01.png', 'grid-02.png']);
    expect(warnings.map((item) => item.code)).toEqual(['W_LEFTOVER_REMOVED', 'W_LEFTOVER_REMOVED']);
  });

  it('never touches a file the previous report did not list', async () => {
    await exportInto(await delivery(), { names: ['grid-01.svg', 'grid-02.svg'] });
    await writeFile(join(folder(), 'leia-me.txt'), 'a note somebody left for the client');
    await writeFile(join(folder(), 'grid-09.svg'), 'named like artwork, but not Tyto’s');

    const warnings = await exportInto(await delivery(), { names: ['grid-01.svg'] });

    expect(await artwork()).toEqual(['grid-01.svg', 'grid-09.svg', 'leia-me.txt']);
    expect(warnings.map((item) => item.code)).toEqual(['W_LEFTOVER_REMOVED']);
  });

  it('keeps a listed file somebody replaced by hand, because its size is not the recorded one', async () => {
    await exportInto(await delivery(), { names: ['grid-01.svg', 'grid-02.svg'] });
    await writeFile(join(folder(), 'grid-02.svg'), 'retouched by hand, and a different size');

    const warnings = await exportInto(await delivery(), { names: ['grid-01.svg'] });

    expect(await artwork()).toEqual(['grid-01.svg', 'grid-02.svg']);
    expect(codes(warnings)).toEqual([
      expect.stringMatching(
        /^W_LEFTOVER_KEPT Kept 'grid-02\.svg'.*: it changed after Tyto wrote it \(\d+ bytes then, \d+ now\)\.$/u,
      ),
    ]);
  });

  it.each([
    ['../outside.png', 'a parent folder'],
    ['..\\outside.png', 'a parent folder, Windows-spelled'],
    ['editaveis/campanha.brief', 'the editable folder'],
    ['C:outside.png', 'a drive-relative path'],
  ])('refuses %s (%s) and deletes nothing outside the folder', async (name) => {
    // The target exists and has exactly the recorded size, so only the name rule stands
    // between it and `rm`.
    const outside = join(workspace, 'entregas', 'outside.png');
    await mkdir(join(workspace, 'entregas'), { recursive: true });
    await writeFile(outside, 'precious');
    await exportInto(await delivery(), { names: [] });
    await previousResult([{ name, bytes: 'precious'.length }]);

    const warnings = await exportInto(await delivery(), { names: ['grid-01.svg'] });

    expect(await readFile(outside, 'utf8')).toBe('precious');
    expect(await readFile(join(folder(), EDITABLE_DIR, 'campanha.brief'), 'utf8')).toBe(
      '::titulo Oi\n',
    );
    expect(codes(warnings)).toEqual([
      expect.stringMatching(
        /^W_LEFTOVER_KEPT .*: refused, it names a path, not a file in this folder\.$/u,
      ),
    ]);
  });

  it('removes nothing, and warns, when the export did not finish', async () => {
    await exportInto(await delivery(), { names: ['grid-01.svg', 'grid-02.svg'] });

    const warnings = await exportInto(await delivery(), { names: ['grid-01.svg'], planned: 2 });

    expect(await artwork()).toEqual(['grid-01.svg', 'grid-02.svg']);
    expect(codes(warnings)).toEqual([
      expect.stringMatching(/^W_LEFTOVER_KEPT Kept 'grid-02\.svg'.*did not finish/u),
    ]);
  });

  it('removes nothing, and warns, when the export reported an error', async () => {
    await exportInto(await delivery(), { names: ['grid-01.svg', 'grid-02.svg'] });

    const warnings = await exportInto(await delivery(), { names: ['grid-01.svg'], failed: true });

    expect(await artwork()).toEqual(['grid-01.svg', 'grid-02.svg']);
    expect(warnings.map((item) => item.code)).toEqual(['W_LEFTOVER_KEPT']);
  });

  it('removes nothing, and warns, over a result.json it cannot read', async () => {
    await exportInto(await delivery(), { names: ['grid-01.svg', 'grid-02.svg'] });
    await writeFile(join(folder(), EDITABLE_DIR, RESULT_FILE), '{ "artifacts": [ edited by hand');

    const warnings = await exportInto(await delivery(), { names: ['grid-01.svg'] });

    expect(await artwork()).toEqual(['grid-01.svg', 'grid-02.svg']);
    expect(warnings.map((item) => item.code)).toEqual(['W_PREVIOUS_RESULT_UNREADABLE']);
  });

  it('removes nothing, and says nothing, on the first export into a folder', async () => {
    await mkdir(folder(), { recursive: true });
    await writeFile(join(folder(), 'grid-02.svg'), 'there before Tyto ever was');

    const warnings = await exportInto(await delivery(), { names: ['grid-01.svg'] });

    expect(await artwork()).toEqual(['grid-01.svg', 'grid-02.svg']);
    expect(warnings).toEqual([]);
  });

  it('skips a listed file that is already gone', async () => {
    await exportInto(await delivery(), { names: ['grid-01.svg', 'grid-02.svg'] });
    await rm(join(folder(), 'grid-02.svg'));

    expect(await exportInto(await delivery(), { names: ['grid-01.svg'] })).toEqual([]);
  });
});

describe('fsTaskOutput, the flat folder', () => {
  it('removes nothing unless it was opened with removeLeftovers — the --out contract', async () => {
    const out = join(workspace, 'out');
    await exportInto(await fsTaskOutput(out), { names: ['grid-01.svg', 'grid-02.svg'] });

    const warnings = await exportInto(await fsTaskOutput(out), { names: ['grid-01.svg'] });

    expect(warnings).toEqual([]);
    expect((await readdir(out)).sort()).toEqual(['grid-01.svg', 'grid-02.svg', RESULT_FILE]);
  });

  it('removes a leftover beside result.json when asked, and never result.json itself', async () => {
    const out = join(workspace, 'escolhida');
    const open = () => fsTaskOutput(out, { removeLeftovers: true });
    await exportInto(await open(), { names: ['grid-01.svg', 'grid-02.svg'] });
    const report = await readFile(join(out, RESULT_FILE), 'utf8');
    // A hand-edited report that lists itself. The name rule refuses it before any size is
    // compared, which is what keeps `finish` from finding its own report gone.
    const listed = JSON.parse(report) as { artifacts: { name: string; bytes: number }[] };
    listed.artifacts.push({ ...listed.artifacts[0]!, name: RESULT_FILE });
    await writeFile(join(out, RESULT_FILE), JSON.stringify(listed));

    const warnings = await exportInto(await open(), { names: ['grid-01.svg'] });

    expect((await readdir(out)).sort()).toEqual(['grid-01.svg', RESULT_FILE]);
    expect(codes(warnings)).toEqual([
      expect.stringMatching(/^W_LEFTOVER_REMOVED Removed 'grid-02\.svg'/u),
      expect.stringMatching(
        /^W_LEFTOVER_KEPT Kept 'result\.json'.*: refused, it is the export report itself\.$/u,
      ),
    ]);
  });
});
