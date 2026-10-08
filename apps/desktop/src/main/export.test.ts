import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ok } from '@tyto/core';
import { nodeFileSystem } from '@tyto/io';
import type { LoadedPlugins, Plugin } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

let service: ExportService;
let out: string;

beforeEach(async () => {
  out = mkdtempSync(join(tmpdir(), 'tyto-export-'));
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

  it('delivers into the picked folder: artwork on top, editaveis/ and assets/ (TYTO-205)', async () => {
    const examples = join(packDirectory, 'agenda-semana', 'examples');
    const { exportId } = await service.start({
      brief: exampleBrief('agenda-semana', 'agenda.brief'),
      directory: out,
      briefDirectory: examples,
      label: 'agenda',
      outputs: [{ kind: 'svg' }],
      removeLeftovers: true,
      delivery: true,
    });

    const progress = await settled(exportId);

    expect(progress.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    // No level named after the brief: the folder the person picked is the delivery.
    expect(readdirSync(out).sort()).toEqual(['assets', 'editaveis', 'grid-01.svg', 'grid-02.svg']);
    expect(readdirSync(join(out, 'editaveis')).sort()).toEqual([
      'agenda.brief',
      'result.json',
      'template.txt',
    ]);
    expect(readdirSync(join(out, 'assets'))).toEqual(['calendario.png']);
    expect(readFileSync(join(out, 'editaveis', 'agenda.brief'), 'utf8')).toContain(
      'imagem: calendario.png\n',
    );
  }, 60_000);

  it('answers a file named editaveis in the picked folder with a diagnostic, not a failure', async () => {
    // Was `failure: "ENOTDIR … mkdir '…\editaveis'"` in the dialog: the operating system's
    // wording for something the person fixes by renaming a file (TYTO-129).
    writeFileSync(join(out, 'editaveis'), 'nao sou pasta');
    const { exportId } = await service.start({
      brief: exampleBrief('agenda-semana', 'agenda.brief'),
      directory: out,
      briefDirectory: join(packDirectory, 'agenda-semana', 'examples'),
      label: 'agenda',
      outputs: [{ kind: 'svg' }],
      delivery: true,
    });

    const progress = await settled(exportId);

    expect(progress.failure).toBeUndefined();
    expect(progress.status).toBe('finished');
    expect(progress.diagnostics.map((item) => [item.code, item.message])).toEqual([
      [
        'E_DELIVERY_FOLDER_BLOCKED',
        `'${join(out, 'editaveis')}' is a file, and the delivery needs a folder with that name. Rename or move the file, or deliver somewhere else.`,
      ],
    ]);
    expect(readdirSync(out)).toEqual(['editaveis']);
  }, 60_000);

  it('answers a file named assets with an error beside the artwork it did write', async () => {
    writeFileSync(join(out, 'assets'), 'nao sou pasta');
    const { exportId } = await service.start({
      brief: exampleBrief('agenda-semana', 'agenda.brief'),
      directory: out,
      briefDirectory: join(packDirectory, 'agenda-semana', 'examples'),
      label: 'agenda',
      outputs: [{ kind: 'svg' }],
      delivery: true,
    });

    const progress = await settled(exportId);

    expect(progress.failure).toBeUndefined();
    // Errors only: this run renders, and a machine without the template's faces adds a
    // W_FONT_SUBSTITUTED per weight beside it, as the CI's Linux does.
    expect(
      progress.diagnostics.filter((item) => item.severity === 'error').map((item) => item.code),
    ).toEqual(['E_DELIVERY_FOLDER_BLOCKED']);
    expect(progress.result?.status).toBe('error');
    expect(readdirSync(out).sort()).toEqual(['assets', 'editaveis', 'grid-01.svg', 'grid-02.svg']);
  }, 60_000);

  // TYTO-243: a folder where the delivery writes a file. Was `failure: "EPERM … rename"`.
  it.each([
    ['the copied brief', ['editaveis', 'agenda.brief']],
    ['template.txt', ['editaveis', 'template.txt']],
    ['an image in assets/', ['assets', 'calendario.png']],
    ['result.json', ['editaveis', 'result.json']],
  ])(
    'answers a folder holding %s with a diagnostic, not a failure',
    async (_, segments) => {
      const held = join(out, ...segments);
      mkdirSync(held, { recursive: true });
      const { exportId } = await service.start({
        brief: exampleBrief('agenda-semana', 'agenda.brief'),
        directory: out,
        briefDirectory: join(packDirectory, 'agenda-semana', 'examples'),
        label: 'agenda',
        outputs: [{ kind: 'svg' }],
        delivery: true,
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
    },
    60_000,
  );

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
      brief: exampleBrief('aprovados', 'aprovados.brief'),
      directory: out,
      label: 'aprovados',
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
      brief: exampleBrief('aprovados', 'aprovados.brief'),
      directory: out,
      label: 'aprovados',
      outputs: [{ kind: 'txt' }],
    });

    expect(progress.failure).toMatch(/No registered exporter produces 'txt'/u);
  }, 60_000);
});
