import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { nodeFileSystem } from '@tyto/io';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ExportProgress, type ExportService, createExportService } from './export.js';

/**
 * The export, against the pack the app actually ships.
 *
 * `preview.test.ts`'s argument, and it applies harder here: what this card changed is the
 * *composition* — which stages run, with which resources, into which sink — and every stage
 * already has unit tests against fakes. Wiring is only wrong against the real thing.
 *
 * **What this file cannot answer is the card's headline criterion.** *The same 12 files as
 * `tyto render`* is a claim about two programs, and only one of them is in this process.
 * `e2e/export.desktop.test.ts` runs the CLI and the app over one brief and diffs the two
 * folders; this file checks the parts that do not need a second program — that the files
 * appear, that the names are the CLI's, that cancelling stops and says so.
 *
 * No rasterizer is registered in these tests, on purpose. A `Rasterizer` here means Electron,
 * and this suite runs in `pnpm check`. So the outputs are SVG, and PNG is the e2e's question.
 */

const require_ = createRequire(import.meta.url);
const packDirectory = join(dirname(require_.resolve('@tyto/templates/package.json')), 'templates');

const exampleBrief = (template: string, file: string): string =>
  readFileSync(join(packDirectory, template, 'examples', file), 'utf8');

let service: ExportService;
let out: string;

beforeEach(async () => {
  out = mkdtempSync(join(tmpdir(), 'tyto-export-'));
  service = await createExportService({ fileSystem: nodeFileSystem(), version: '0.0.0-test' });
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
});

/** Polls until the run is over, or throws with the state it got stuck in. */
async function settled(exportId: string, timeoutMs = 30_000): Promise<ExportProgress> {
  const started = Date.now();
  for (;;) {
    const progress = service.progress(exportId);
    if (progress === undefined) throw new Error(`no such export: ${exportId}`);
    if (progress.status !== 'running') return progress;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `export still running after ${String(timeoutMs)} ms: ${JSON.stringify(progress)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('the export service', () => {
  it('writes the artifacts and a result.json beside them', async () => {
    const { exportId } = await service.start({
      brief: exampleBrief('promo-curso', 'promo.brief'),
      directory: out,
      label: 'promo',
      outputs: [{ kind: 'svg' }],
    });

    const progress = await settled(exportId);

    expect(progress.failure).toBeUndefined();
    expect(progress.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(progress.status).toBe('finished');

    const files = readdirSync(out).sort();

    // `result.json` is the file the other side of ADR 0011 watches for, and it is written
    // last — so its presence is also the statement that the run is over.
    expect(files).toContain('result.json');
    expect(files.filter((name) => name.endsWith('.svg')).length).toBeGreaterThan(0);
  }, 60_000);

  it('answers with a plan before it answers with files', async () => {
    // The whole reason progress is pollable. `total` arrives from the job's `planned` event,
    // which fires once the scene exists and before the first frame is written, so a dialog
    // can draw a bar with a denominator rather than a spinner.
    const { exportId } = await service.start({
      brief: exampleBrief('carrossel-lista', 'lista.brief'),
      directory: out,
      label: 'lista',
      outputs: [{ kind: 'svg' }],
    });

    const progress = await settled(exportId);

    expect(progress.total).toBeGreaterThan(0);
    expect(progress.done).toBe(progress.total);
    expect(progress.failed).toBe(0);
  }, 60_000);

  it('leaves a folder whose result.json names exactly the files that are in it', async () => {
    // **The assertion that catches the second-export trap.** `fsTaskOutput` writes into the
    // folder it is given and never clears it, so a file from a previous run that this run
    // does not produce survives — and *the same 12 files as `tyto render`* is a claim about
    // the folder, not about what this run happened to write. Comparing the manifest against
    // the directory listing is what notices a thirteenth file.
    //
    // It also measures the naming without restating it: the artifact names come from
    // `artifactName(artwork, format, kind)` in `pipeline`, not from the label, so asserting
    // a shape here would only repeat the implementation. What matters is that the document
    // and the disk agree.
    const { exportId } = await service.start({
      brief: exampleBrief('promo-curso', 'promo.brief'),
      directory: out,
      label: 'chosen-label',
      outputs: [{ kind: 'svg' }],
    });

    const progress = await settled(exportId);

    const named = (progress.result?.artifacts ?? []).map((artifact) => artifact.name).sort();
    const onDisk = readdirSync(out)
      .filter((name) => name !== 'result.json')
      .sort();

    expect(named.length).toBeGreaterThan(0);
    expect(onDisk).toEqual(named);
  }, 60_000);

  it('reports a brief that does not compile instead of throwing', async () => {
    const { exportId } = await service.start({
      brief: 'this is not a brief',
      directory: out,
      label: 'broken',
      outputs: [{ kind: 'svg' }],
    });

    const progress = await settled(exportId);

    // A failed run still finishes, still writes `result.json`, and carries its errors as
    // diagnostics — `failure` stays empty because nothing here is the operating system's
    // answer. That distinction is the field's whole reason to exist.
    expect(progress.status).toBe('finished');
    expect(progress.failure).toBeUndefined();
    expect(progress.diagnostics.filter((item) => item.severity === 'error').length).toBeGreaterThan(
      0,
    );
    expect(readdirSync(out)).toContain('result.json');
  }, 60_000);

  it('stops when cancelled, and says it was cancelled', async () => {
    const { exportId } = await service.start({
      brief: exampleBrief('carrossel-lista', 'lista.brief'),
      directory: out,
      label: 'lista',
      outputs: [{ kind: 'svg' }],
    });

    service.cancel(exportId);
    const progress = await settled(exportId);

    expect(progress.status).toBe('cancelled');
    expect(progress.result?.cancelled).toBe(true);
  }, 60_000);

  it('has nothing to say about an id it never started', () => {
    // `undefined` rather than an empty progress: a dialog polling a typo should find out,
    // not watch a bar that never moves.
    expect(service.progress('export-nope')).toBeUndefined();
    expect(() => {
      service.cancel('export-nope');
    }).not.toThrow();
  });
});
