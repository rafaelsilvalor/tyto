import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ok } from '@tyto/core';
import { NO_INSTALLED_PACKS, NO_PLUGIN_FILES, nodeFileSystem } from '@tyto/io';
import type { LoadedPlugins, Plugin } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  type ExportProgress,
  type ExportService,
  availableOutputs,
  createExportService,
} from './export.js';
import { createProjectSources } from './project.js';

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

/** A 1×1 PNG: a picture the brief draws, which an artwork-only export does not copy. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * `promo-curso`'s example with a picture beside it, in `examples`: what the export box once
 * copied into the picked folder, the brief into `editaveis/` and the picture into `assets/`
 * (ADR 0057), and since TYTO-490 does not (ADR 0157).
 */
function promoWithPicture(): string {
  mkdirSync(join(examples, 'assets'), { recursive: true });
  writeFileSync(join(examples, 'assets', 'foto.png'), PNG);
  return exampleBrief('promo-curso', 'promo.brief').replace(
    'tom: laranja\n',
    'tom: laranja\nimagem: ./foto.png\n',
  );
}

let service: ExportService;
let out: string;
let examples: string;

beforeEach(async () => {
  out = mkdtempSync(join(tmpdir(), 'tyto-export-'));
  examples = mkdtempSync(join(tmpdir(), 'tyto-export-brief-'));
  service = await createExportService({
    fileSystem: nodeFileSystem(),
    sources: await createProjectSources({
      fileSystem: nodeFileSystem(),
      builtIn: packDirectory,
    }),
    version: '0.0.0-test',
  });
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
  rmSync(examples, { recursive: true, force: true });
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

  it('writes only the artwork into the picked folder: no result.json, editaveis/ or assets/ (TYTO-490)', async () => {
    const { exportId } = await service.start({
      brief: promoWithPicture(),
      directory: out,
      briefDirectory: examples,
      label: 'promo',
      outputs: [{ kind: 'svg' }],
      artworkOnly: true,
    });

    const progress = await settled(exportId);

    expect(progress.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    // No level named after the brief, and nothing beside the artwork (ADR 0157).
    expect(readdirSync(out).sort()).toEqual(['grid-1x1-01.svg', 'story-01.svg']);
    // The report still reaches the dialog; it is only not written to the folder.
    expect(progress.result?.artifacts.map((artifact) => artifact.name).sort()).toEqual([
      'grid-1x1-01.svg',
      'story-01.svg',
    ]);
  }, 60_000);

  it('answers a file holding the picked folder with a diagnostic, not a failure', async () => {
    // Was `failure: "ENOTDIR … mkdir"` in the dialog: the operating system's wording for
    // something the person fixes by renaming a file (TYTO-129).
    const picked = join(out, 'escolhida');
    writeFileSync(picked, 'nao sou pasta');
    const { exportId } = await service.start({
      brief: promoWithPicture(),
      directory: picked,
      briefDirectory: examples,
      label: 'promo',
      outputs: [{ kind: 'svg' }],
      artworkOnly: true,
    });

    const progress = await settled(exportId);

    expect(progress.failure).toBeUndefined();
    expect(progress.status).toBe('finished');
    expect(progress.diagnostics.map((item) => [item.code, item.message])).toEqual([
      [
        'E_DELIVERY_FOLDER_BLOCKED',
        `'${picked}' is a file, and Tyto needs a folder with that name. Rename or move the file, or export somewhere else.`,
      ],
    ]);
    expect(readdirSync(out)).toEqual(['escolhida']);
  }, 60_000);

  // TYTO-243: a folder where the export writes a file. Was `E_OUTPUT_WRITE Could not write
  // 'grid-01.svg': …` until ADR 0108.
  it('answers a folder holding an artwork file with a diagnostic, not a failure', async () => {
    const held = join(out, 'grid-1x1-01.svg');
    mkdirSync(held, { recursive: true });
    const { exportId } = await service.start({
      brief: promoWithPicture(),
      directory: out,
      briefDirectory: examples,
      label: 'promo',
      outputs: [{ kind: 'svg' }],
      artworkOnly: true,
    });

    const progress = await settled(exportId);

    expect(progress.failure).toBeUndefined();
    expect(progress.status).toBe('finished');
    // Errors only, for the W_FONT_SUBSTITUTED the CI's Linux adds beside a run that renders.
    expect(
      progress.diagnostics
        .filter((item) => item.severity === 'error')
        .map((item) => [item.code, item.message]),
    ).toEqual([
      [
        'E_OUTPUT_FILE_BLOCKED',
        `'${held}' is a folder, and Tyto needs to write a file with that name. Rename or move the folder, or write somewhere else.`,
      ],
    ]);
  }, 60_000);

  // ADR 0108: what the sink cannot explain ends the run, as a lock does, and is the dialog's
  // failure rather than a diagnostic. A folder at the scratch name stands in for the lock,
  // which Node cannot take; the real one was measured by hand for the PR.
  it('answers an artwork write nobody explained with a failure, not a diagnostic', async () => {
    mkdirSync(join(out, 'grid-1x1-01.svg.part', 'dentro'), { recursive: true });
    const { exportId } = await service.start({
      brief: promoWithPicture(),
      directory: out,
      briefDirectory: examples,
      label: 'promo',
      outputs: [{ kind: 'svg' }],
    });

    const progress = await settled(exportId);

    expect(progress.status).toBe('finished');
    expect(progress.failure).toBeDefined();
    expect(progress.diagnostics.map((item) => item.code)).not.toContain('E_OUTPUT_WRITE');
    // The queue's layout, the one that keeps a report: a run that ended this way leaves none.
    expect(readdirSync(out)).not.toContain('result.json');
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

  it('removes what its previous export wrote only when asked, which the queue never does', async () => {
    // ADR 0054. Four artworks, then three, into one folder: the export box asks for leftovers
    // to go and the queue does not, and the two must stay different.
    const four = exampleBrief('carrossel-lista', 'lista.brief');
    const three = four.slice(0, four.lastIndexOf('::lamina'));
    const exportInto = async (brief: string, removeLeftovers: boolean) =>
      settled(
        (
          await service.start({
            brief,
            directory: out,
            label: 'lista',
            outputs: [{ kind: 'svg' }],
            removeLeftovers,
          })
        ).exportId,
      );

    await exportInto(four, false);
    const kept = await exportInto(three, false);
    expect(readdirSync(out)).toContain('story-04.svg');
    expect(kept.diagnostics.map((item) => item.code)).not.toContain('W_LEFTOVER_REMOVED');

    await exportInto(four, true);
    const removed = await exportInto(three, true);
    expect(readdirSync(out)).not.toContain('story-04.svg');
    expect(removed.diagnostics.filter((item) => item.code === 'W_LEFTOVER_REMOVED')).toHaveLength(
      2,
    );
    // In the report on disk too, which is what somebody opening the folder later reads.
    expect(removed.result?.diagnostics.map((item) => item.code)).toContain('W_LEFTOVER_REMOVED');
  }, 60_000);

  it('removes nothing from the picked folder, because it keeps no report (TYTO-490)', async () => {
    // With no result.json, Tyto cannot tell the fourth slide it wrote last time from a file
    // the person put there, so it stays (ADR 0157).
    const four = exampleBrief('carrossel-lista', 'lista.brief');
    const three = four.slice(0, four.lastIndexOf('::lamina'));
    const exportInto = async (brief: string) =>
      settled(
        (
          await service.start({
            brief,
            directory: out,
            label: 'lista',
            outputs: [{ kind: 'svg' }],
            removeLeftovers: true,
            artworkOnly: true,
          })
        ).exportId,
      );

    await exportInto(four);
    const kept = await exportInto(three);

    expect(readdirSync(out)).toContain('story-04.svg');
    expect(readdirSync(out)).not.toContain('result.json');
    expect(kept.diagnostics.map((item) => item.code)).not.toContain('W_LEFTOVER_REMOVED');
  }, 60_000);

  it('exports a delivery: artwork at its root, the report beside its brief, leftovers removed (TYTO-490)', async () => {
    // ADR 0157 §6. Four slides then three into one delivery: the fourth goes, because this
    // export keeps a result.json, in editaveis/, that says it was Tyto's.
    const report = join(out, 'editaveis');
    const four = exampleBrief('carrossel-lista', 'lista.brief');
    const three = four.slice(0, four.lastIndexOf('::lamina'));
    const exportInto = async (brief: string) =>
      settled(
        (
          await service.start({
            brief,
            directory: out,
            label: 'lista',
            outputs: [{ kind: 'svg' }],
            deliveryReport: report,
          })
        ).exportId,
      );

    await exportInto(four);
    const second = await exportInto(three);

    expect(second.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(readdirSync(out)).not.toContain('story-04.svg');
    expect(readdirSync(out)).not.toContain('result.json');
    expect(readdirSync(report).sort()).toEqual(['result.json', 'template.txt']);
    expect(second.diagnostics.filter((item) => item.code === 'W_LEFTOVER_REMOVED')).toHaveLength(2);
  }, 60_000);

  it("copies a delivery's image from beside its brief into assets/, keeping a different one there (TYTO-499)", async () => {
    // ADR 0161. The picture sits beside the brief in editaveis/, outside the delivery's
    // assets/: the first export copies it, and a second finds the person's own file of that
    // name, keeps it and says so.
    const report = join(out, 'editaveis');
    mkdirSync(report, { recursive: true });
    writeFileSync(join(report, 'foto.png'), PNG);
    const brief = exampleBrief('promo-curso', 'promo.brief').replace(
      'tom: laranja\n',
      'tom: laranja\nimagem: ./foto.png\n',
    );
    const exportOnce = async () =>
      settled(
        (
          await service.start({
            brief,
            directory: out,
            briefDirectory: report,
            label: 'promo',
            outputs: [{ kind: 'svg' }],
            deliveryReport: report,
          })
        ).exportId,
      );

    const first = await exportOnce();

    expect(first.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(readdirSync(join(out, 'assets'))).toEqual(['foto.png']);
    expect(readFileSync(join(out, 'assets', 'foto.png'))).toEqual(PNG);

    writeFileSync(join(out, 'assets', 'foto.png'), 'the person’s own foto.png');
    const second = await exportOnce();

    expect(second.diagnostics.map((item) => item.code)).toContain('W_DELIVERY_ASSET_KEPT');
    expect(readFileSync(join(out, 'assets', 'foto.png'), 'utf8')).toBe('the person’s own foto.png');
    expect(readdirSync(report).sort()).toEqual(['foto.png', 'result.json', 'template.txt']);
  }, 60_000);

  describe("a delivery's run that did not finish leaves assets/ as it was (TYTO-499)", () => {
    // ADR 0161, with ADR 0054's test for "did not finish". The picture is resolved in both runs
    // (the frames are planned after it), so only the guard keeps it out of assets/.
    const report = () => join(out, 'editaveis');
    const pictured = (): string => {
      mkdirSync(report(), { recursive: true });
      writeFileSync(join(report(), 'foto.png'), PNG);
      return exampleBrief('promo-curso', 'promo.brief').replace(
        'tom: laranja\n',
        'tom: laranja\nimagem: ./foto.png\n',
      );
    };

    it('a failed run: the rasterizer refuses every frame', async () => {
      const failing = await createExportService({
        fileSystem: nodeFileSystem(),
        sources: await createProjectSources({
          fileSystem: nodeFileSystem(),
          builtIn: packDirectory,
        }),
        version: '0.0.0-test',
        rasterizer: { raster: () => Promise.reject(new Error('the tab crashed')) },
      });
      const { exportId } = await failing.start({
        brief: pictured(),
        directory: out,
        briefDirectory: report(),
        label: 'promo',
        outputs: [{ kind: 'png' }],
        deliveryReport: report(),
      });

      let progress = failing.progress(exportId);
      for (
        const begun = Date.now();
        progress?.status === 'running';
        progress = failing.progress(exportId)
      ) {
        if (Date.now() - begun > 30_000) throw new Error('the failed run never ended');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(progress?.failure).toBeUndefined();
      expect(progress?.diagnostics.some((item) => item.severity === 'error')).toBe(true);
      expect(readdirSync(out)).not.toContain('assets');
    }, 60_000);

    it('a cancelled run: cancelled from inside its first frame', async () => {
      let started: (id: string) => void = () => undefined;
      const exportId = new Promise<string>((resolve) => {
        started = resolve;
      });
      const cancelling = await createExportService({
        fileSystem: nodeFileSystem(),
        sources: await createProjectSources({
          fileSystem: nodeFileSystem(),
          builtIn: packDirectory,
        }),
        version: '0.0.0-test',
        // The first frame cancels the run and still answers, so the job stops at the next.
        rasterizer: {
          raster: async () => {
            cancelling.cancel(await exportId);
            return new TextEncoder().encode('png');
          },
        },
      });
      const { exportId: id } = await cancelling.start({
        brief: pictured(),
        directory: out,
        briefDirectory: report(),
        label: 'promo',
        outputs: [{ kind: 'png' }],
        deliveryReport: report(),
      });
      started(id);

      let progress = cancelling.progress(id);
      for (
        const begun = Date.now();
        progress?.status === 'running';
        progress = cancelling.progress(id)
      ) {
        if (Date.now() - begun > 30_000) throw new Error('the cancelled run never ended');
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(progress?.status).toBe('cancelled');
      expect(readdirSync(out)).not.toContain('assets');
    }, 60_000);
  });

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

describe('installed plugins in the export (TYTO-48)', () => {
  const manifestOf = (name: string): unknown => ({
    name,
    version: '1.0.0',
    engine: '>=0.1',
    contributes: ['exporter'],
    permissions: [],
  });

  /**
   * What `startDesktopPlugins` hands over, with the plugins in process: the export's half is
   * how they are activated, and the process they live in is `plugin-process.test.ts`'s.
   */
  const installed = (...plugins: Plugin[]): LoadedPlugins => ({
    plugins,
    warnings: [],
    close: () => Promise.resolve(),
  });

  const texto: Plugin = {
    id: 'texto',
    manifest: manifestOf('texto'),
    activate: (host) =>
      host.registerExporter({
        id: 'texto',
        mime: 'text/plain',
        extension: 'txt',
        kinds: ['txt'],
        rasterized: false,
        exportFrame: (_scene, artwork, frame) => ok(`${artwork.id} ${frame.format}`),
      }),
  };

  // A second `svg`: activated after the built-ins, so it is the one refused.
  const impostor: Plugin = {
    id: 'vetor',
    manifest: manifestOf('vetor'),
    activate: (host) =>
      host.registerExporter({
        id: 'svg',
        mime: 'image/svg+xml',
        extension: 'svg',
        kinds: ['svg'],
        rasterized: false,
        exportFrame: () => ok('<svg/>'),
      }),
  };

  async function serviceWith(plugins: LoadedPlugins): Promise<ExportService> {
    return createExportService({
      fileSystem: nodeFileSystem(),
      sources: await createProjectSources({ fileSystem: nodeFileSystem(), builtIn: packDirectory }),
      version: '0.0.0-test',
      plugins: Promise.resolve(plugins),
    });
  }

  it("offers an installed exporter's kind beside the built-ins", async () => {
    const kinds = await (await serviceWith(installed(texto))).kinds();
    expect(kinds.map((item) => item.kind)).toEqual(['png', 'jpeg', 'webp', 'svg', 'txt']);
  });

  it('renders that kind through run, the door the queue uses', async () => {
    const progress = await (
      await serviceWith(installed(texto))
    ).run({
      brief: exampleBrief('promo-curso', 'promo.brief'),
      directory: out,
      label: 'promo',
      outputs: [{ kind: 'txt' }],
    });

    expect(progress.failure).toBeUndefined();
    const texts = readdirSync(out).filter((name) => name.endsWith('.txt'));
    expect(texts.length).toBeGreaterThan(0);
    expect(readFileSync(join(out, texts[0]!), 'utf8')).toMatch(/^\S+ \S+$/u);
  }, 60_000);

  it("names a refused plugin in the run's diagnostics, and renders with Tyto's own", async () => {
    const progress = await (
      await serviceWith(installed(impostor))
    ).run({
      brief: exampleBrief('promo-curso', 'promo.brief'),
      directory: out,
      label: 'promo',
      outputs: [{ kind: 'svg' }],
    });

    expect(progress.diagnostics.filter((item) => item.code === 'W_PLUGIN_SKIPPED')).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("Plugin 'vetor' was refused") as unknown,
      }),
    ]);
    const svg = readdirSync(out).find((name) => name.endsWith('.svg'));
    expect(readFileSync(join(out, svg!), 'utf8')).not.toBe('<svg/>');
  }, 60_000);

  // A plugin's setting, read in its exporter (TYTO-254, ADR 0145). It writes what `host.config`
  // answered at activation and again in `exportFrame`, so the first half says the run's host was
  // configured before the plugin was activated into it.
  it("hands an installed plugin its settings before activating it into the run's host", async () => {
    const baseUrl = z.object({ baseUrl: z.string() }).partial().optional();
    const conector: Plugin = {
      id: 'conector',
      manifest: {
        ...(manifestOf('conector') as object),
        contributes: ['exporter', 'configuration'],
      },
      activate: (host) => {
        host.registerConfiguration({
          id: 'baseUrl',
          form: { type: 'string', format: 'uri' },
          default: 'https://default.example',
          description: 'Where the service is.',
        });
        const atActivation = String(host.config(baseUrl)?.baseUrl);
        return host.registerExporter({
          id: 'cfg',
          mime: 'text/plain',
          extension: 'cfg',
          kinds: ['cfg'],
          rasterized: false,
          exportFrame: () => ok(`${atActivation} ${String(host.config(baseUrl)?.baseUrl)}`),
        });
      },
    };
    const service = await createExportService({
      fileSystem: nodeFileSystem(),
      sources: await createProjectSources({ fileSystem: nodeFileSystem(), builtIn: packDirectory }),
      version: '0.0.0-test',
      plugins: Promise.resolve(installed(conector)),
      configuration: () => ({ conector: { baseUrl: 'https://acme.example' } }),
    });
    const progress = await service.run({
      brief: exampleBrief('promo-curso', 'promo.brief'),
      directory: out,
      label: 'promo',
      outputs: [{ kind: 'cfg' }],
    });

    expect(progress.failure).toBeUndefined();
    const written = readdirSync(out).filter((name) => name.endsWith('.cfg'));
    expect(written.length).toBeGreaterThan(0);
    expect(readFileSync(join(out, written[0]!), 'utf8')).toBe(
      'https://acme.example https://acme.example',
    );
  }, 60_000);
});

describe('a queue kind whose exporter is gone (TYTO-188)', () => {
  const only = (...kinds: string[]) => ({
    forKind: (kind: string) => (kinds.includes(kind) ? {} : undefined),
  });

  it('keeps what the host produces and warns once for each kind it does not', () => {
    const { outputs, dropped } = availableOutputs(
      [{ kind: 'png' }, { kind: 'pdf' }, { kind: 'svg' }],
      only('png', 'svg'),
    );

    expect(outputs).toEqual([{ kind: 'png' }, { kind: 'svg' }]);
    expect(dropped).toEqual([
      expect.objectContaining({
        code: 'W_QUEUE_KIND_UNAVAILABLE',
        severity: 'warning',
        message: expect.stringContaining("'pdf'") as unknown,
      }),
    ]);
  });

  it('falls back to PNG when nothing chosen is left, rather than rendering nothing', () => {
    const { outputs, dropped } = availableOutputs([{ kind: 'pdf' }], only('png'));

    expect(outputs).toEqual([{ kind: 'png' }]);
    expect(dropped.map((item) => item.message)).toEqual([
      "Did not produce 'pdf': no exporter on this machine produces it any more, so this task produced png.",
    ]);
  });

  it('drops it in a real run, and result.json says so beside the files it lists', async () => {
    const progress = await service.run({
      brief: exampleBrief('promo-curso', 'promo.brief'),
      directory: out,
      label: 'promo',
      outputs: [{ kind: 'svg' }, { kind: 'txt' }],
      dropUnavailableKinds: true,
    });

    expect(progress.failure).toBeUndefined();
    const result = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8')) as {
      artifacts: { kind: string }[];
      diagnostics: { code: string }[];
    };
    expect(result.artifacts.length).toBeGreaterThan(0);
    expect(new Set(result.artifacts.map((artifact) => artifact.kind))).toEqual(new Set(['svg']));
    expect(
      result.diagnostics.filter((item) => item.code === 'W_QUEUE_KIND_UNAVAILABLE'),
    ).toHaveLength(1);
  }, 60_000);

  it('still refuses an unknown kind from the export box, which never asks to drop one', async () => {
    const progress = await service.run({
      brief: exampleBrief('promo-curso', 'promo.brief'),
      directory: out,
      label: 'promo',
      outputs: [{ kind: 'txt' }],
    });

    expect(progress.failure).toMatch(/No registered exporter produces 'txt'/u);
  }, 60_000);
});

describe("the export of a plugin file's alias (TYTO-433, ADR 0151)", () => {
  // No template left in the pack declares `values` (TYTO-436), so the configuration shows
  // itself through its brief side (TYTO-440): a subtitle the brief leaves unset.
  const SUBTITLE = 'Vagas limitadas';
  const ALIASED = {
    name: 'turma',
    alias: 'promo-turma',
    values: {},
    brief: { slots: { subtitulo: { value: SUBTITLE } } },
  };
  const briefOfAlias = (): string => {
    const example = exampleBrief('promo-curso', 'promo.brief');
    return example
      .slice(0, example.indexOf('::subtitulo'))
      .replace('template: promo-curso', 'template: promo-turma');
  };

  it('exports the template the alias reaches, with its configuration', async () => {
    const sources = await createProjectSources({
      fileSystem: nodeFileSystem(),
      builtIn: packDirectory,
    });
    await sources.setFetched({
      packs: NO_INSTALLED_PACKS,
      only: new Map(),
      replaces: new Set(),
      problems: [],
      configured: {
        project: [],
        machine: [
          {
            template: 'promo-curso',
            file: 'promos.yaml',
            directory: packDirectory,
            configurations: [ALIASED],
          },
        ],
      },
      images: NO_PLUGIN_FILES.images,
      texts: new Map(),
    });
    const aliased = await createExportService({
      fileSystem: nodeFileSystem(),
      sources,
      version: '0.0.0-test',
    });

    const { exportId } = await aliased.start({
      brief: briefOfAlias(),
      directory: out,
      label: 'turma',
      outputs: [{ kind: 'svg' }],
    });
    for (;;) {
      const progress = aliased.progress(exportId);
      if (progress?.status !== 'running') {
        expect(progress?.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const svg = readdirSync(out).find((name) => name.endsWith('.svg')) ?? '';
    expect(readFileSync(join(out, svg), 'utf8')).toContain(SUBTITLE);
  }, 60_000);
});
