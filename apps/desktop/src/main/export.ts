import { type Diagnostics, type FileSystem } from '@tyto/core';
import { htmlExporterPlugin } from '@tyto/export-html';
import { svgExporterPlugin } from '@tyto/export-svg';
import { bundledFont } from '@tyto/fonts';
import {
  type RenderResult,
  fileAssetResolver,
  fileResources,
  fsTaskOutput,
  renderResult,
} from '@tyto/io';
import { type InProcessHost, type Logger, createPluginHost } from '@tyto/plugin-api';
import {
  type JobEvent,
  type OutputRequest,
  bundledTemplateSource,
  markupTemplateSource,
  runJob,
} from '@tyto/pipeline';
import { BUILT_IN_TEMPLATE_BUILDS } from '@tyto/templates';
import type { Rasterizer } from '@tyto/raster';

import { type ProjectSources } from './project.js';

/**
 * Brief text in, files on disk out — the export's whole job (E9.4, TYTO-43).
 *
 * **The same `runJob` the CLI runs, composed the same way**, which is what the card's
 * acceptance criterion means by *the same 12 files as `tyto render`*. `apps/cli`'s
 * `render-task.ts` is the sibling to read beside this one; where the two differ, the
 * difference is named here rather than left for somebody to find by diffing the outputs.
 *
 * **Progress is asked for, not pushed, and it stays that way now that pushes exist.** When
 * this was written a one-way main→renderer message was a shape the app did not have, and the
 * decision belonged to TYTO-123; ADR 0029 is what it decided. This run still accumulates its
 * state here and the dialog still reads it with `export:progress`, because progress is state
 * a dialog reads rather than a question that needs answering — a push would have to carry the
 * whole record anyway, and a dialog opened mid-run would have to ask once to catch up.
 * The cost is honest and small: the renderer learns about a finished frame up to one poll
 * late, and a poll is cheap because the answer is four numbers.
 *
 * **Cancelling needs nothing new at all.** `runJob` takes an `AbortSignal` and reports
 * `cancelled` in its result, so `export:cancel` is an ordinary request that fires a
 * controller this service holds.
 */

export interface ExportRequest {
  /** The brief's text, as the editor has it — not a second read of the file. */
  readonly brief: string;
  /** The folder the artifacts go in. Created if it is not there. */
  readonly directory: string;
  /** What relative asset paths resolve against; the open file's folder. */
  readonly assetBase?: string;
  /** Names the artifacts, the way `tyto render` names them after the brief. */
  readonly label: string;
  readonly outputs: readonly OutputRequest[];
  /** Absent renders every format the template declares, which is `tyto render`'s default. */
  readonly formats?: readonly string[];
}

export type ExportStatus = 'running' | 'finished' | 'cancelled';

/** What `export:progress` answers with: four numbers and a verdict. */
export interface ExportProgress {
  readonly status: ExportStatus;
  /** The folder the files went to, so "open folder" has somewhere to open. */
  readonly directory: string;
  /** Frames the job means to write. `0` until the plan exists. */
  readonly total: number;
  /** Frames written so far, failed ones included — this is progress, not success. */
  readonly done: number;
  /** Frames that produced a diagnostic instead of a file. */
  readonly failed: number;
  /** Present once the run is over. */
  readonly result?: RenderResult;
  readonly diagnostics: Diagnostics;
  /**
   * The run died of something that is not a diagnostic — a disk that will not take the file,
   * a browser that will not start.
   *
   * A separate field rather than a fabricated `Diagnostic`, because `docs/diagnostic-codes.md`
   * is a closed catalogue and inventing `E_EXPORT_FAILED` for it would make a code that no
   * brief can cause and no document explains. It is `raster.ts`'s distinction, one layer up:
   * an expected error is a `Diagnostic`, and the operating system's answer is not one.
   */
  readonly failure?: string;
}

export interface ExportService {
  /** Starts a run and returns immediately with its id. Never rejects for a bad brief. */
  start(request: ExportRequest): Promise<{ readonly exportId: string }>;
  /** The run's state right now, or `undefined` if nothing was ever started under that id. */
  progress(exportId: string): ExportProgress | undefined;
  /** Fires the run's signal. Idempotent, and a no-op on a run that already finished. */
  cancel(exportId: string): void;
}

export interface ExportServiceOptions {
  readonly fileSystem: FileSystem;
  /**
   * The rasterizer, read out of the plugin registry by the composition root.
   *
   * Absent is a real state and not an error: an SVG-only export needs none, and the CLI
   * leaves it out of the host for the same reason. A PNG asked for without one gets the
   * job's own diagnostic naming the missing rasterizer, which is the honest answer.
   */
  readonly rasterizer?: Rasterizer;
  /**
   * Which folders are searched, read once **per run** rather than held (TYTO-122).
   *
   * Per run and not per frame, deliberately: a folder changed while an export is going must
   * not swap the registry under a job that has already planned its frames. `project.ts` has
   * the rest of the argument.
   */
  readonly sources: ProjectSources;
  /** `tyto`'s own version, for `result.json`. */
  readonly version: string;
  /**
   * Where a run that died is written down (TYTO-132).
   *
   * Optional, and absent in every existing test: a service that required a log to be built
   * would make a logger a dependency of exporting, which it is not. What it changes when it
   * is there is the one place in main where a render's death currently lands — a string in
   * memory that the dialog may or may not still be polling for.
   */
  readonly log?: Logger;
}

/** A run in flight, and what the poller reads. */
interface Run {
  readonly controller: AbortController;
  readonly directory: string;
  status: ExportStatus;
  total: number;
  done: number;
  failed: number;
  result?: RenderResult;
  diagnostics: Diagnostics;
  failure?: string;
}

/**
 * The exporters, built per run because an exporter binds the bytes of the folder it renders.
 *
 * Exactly the CLI's argument (`apps/cli/src/plugins/index.ts`): two documents open on two
 * different folders have two different `assets/`, and an exporter bound to the wrong one
 * embeds the wrong logo. A host is two maps; building one per export costs nothing worth
 * caching, and it is why this is not folded into `activateBuiltIns`, which is built once at
 * startup and owns the things that are not bound to a folder.
 */
function exporterHost(
  resources: ReturnType<typeof fileResources> | undefined,
  rasterizer: Rasterizer | undefined,
): InProcessHost {
  const host = createPluginHost();

  host.activate(
    htmlExporterPlugin({
      resources: { font: bundledFont, ...(resources?.html ?? {}) },
      // The bytes feed a browser, not a reader. Indentation would change the hash of a
      // render for nothing.
      pretty: false,
    }),
  );
  host.activate(svgExporterPlugin({ resources: { font: bundledFont, ...(resources?.svg ?? {}) } }));

  if (rasterizer !== undefined) {
    host.activate({
      id: 'chromium',
      manifest: {
        name: 'chromium',
        version: '0.1.0',
        engine: '>=0.1',
        contributes: ['rasterizer'],
        permissions: [],
      },
      activate: (plugin) =>
        plugin.registerRasterizer<Rasterizer>({ id: 'chromium', value: rasterizer }),
    });
  }

  return host;
}

export async function createExportService(options: ExportServiceOptions): Promise<ExportService> {
  const { fileSystem, sources } = options;

  const runs = new Map<string, Run>();
  let counter = 0;

  async function execute(request: ExportRequest, run: Run): Promise<void> {
    // The snapshot this run is exporting under, taken once at the top. Startup problems are
    // replayed into the run's diagnostics rather than thrown, for `preview.ts`'s reason: an
    // app whose template folder is unreadable should open and say so.
    const { registry: templates, formats: catalogue, diagnostics: startup } = sources.current();

    if (templates === undefined || catalogue === undefined) {
      run.status = 'finished';
      run.diagnostics = [...startup];
      return;
    }

    const images =
      request.assetBase === undefined ? undefined : fileResources({ base: request.assetBase });
    const host = exporterHost(images, options.rasterizer);
    const sink = await fsTaskOutput(request.directory, { label: request.label });

    const job = await runJob(
      {
        brief: request.brief,
        outputs: request.outputs,
        ...(request.formats === undefined ? {} : { formats: request.formats }),
        signal: run.controller.signal,
      },
      {
        registry: templates,
        // Bundled in front of markup, so a template whose body is code draws here the
        // same way it draws through the CLI. Nothing is loaded from a folder either way.
        templates: bundledTemplateSource({
          registry: templates,
          fileSystem,
          bundled: BUILT_IN_TEMPLATE_BUILDS,
          markup: markupTemplateSource(fileSystem, templates),
        }),
        assets: fileAssetResolver({
          // `confine` stays on, its default: a brief is often written by something else
          // (ADR 0011), and `../../../.ssh/id_rsa` embedded in an exported PNG is a real way
          // to leak a file.
          base: request.assetBase ?? request.directory,
        }),
        exporters: host.registry.exporters,
        formats: catalogue,
        ...(options.rasterizer === undefined ? {} : { rasterizer: options.rasterizer }),
        ...(images === undefined ? {} : { loadResources: images.load }),
        sink,
        onEvent: (event: JobEvent) => {
          // The whole of the progress transport. A listener that threw would otherwise take
          // a finished render down with it, which `pipeline` already guards against — but
          // there is nothing here that can throw: four assignments on an object this module
          // owns.
          if (event.kind === 'planned') run.total = event.total;
          if (event.kind === 'frame-finished') run.done = event.done;
          if (event.kind === 'frame-failed') {
            run.done = event.done;
            run.failed += 1;
          }
          if (event.kind === 'cancelled') run.done = event.done;
        },
      },
    );

    const produced = job.ok ? job.diagnostics : job.error;
    run.diagnostics = [...startup, ...produced];

    const cancelled = job.ok ? job.value.cancelled : false;
    run.result = renderResult({
      cancelled,
      planned: job.ok ? job.value.planned : 0,
      artifacts: job.ok ? job.value.artifacts : [],
      diagnostics: run.diagnostics,
      version: options.version,
      // The template the run actually loaded, or none. A run that never got that far names
      // none rather than inventing one, which is `render-task.ts`'s rule.
      templates:
        job.ok && job.value.template !== undefined
          ? [{ name: job.value.template.name, version: job.value.template.version }]
          : [],
    });

    // Written even for a failed run, and last: `result.json` is what the other side of ADR
    // 0011 reads, so a run that produced nothing but errors still has to say so.
    await sink.finish(run.result);

    run.status = cancelled ? 'cancelled' : 'finished';
  }

  return {
    async start(request: ExportRequest): Promise<{ readonly exportId: string }> {
      counter += 1;
      const exportId = `export-${String(counter)}`;
      const run: Run = {
        controller: new AbortController(),
        directory: request.directory,
        status: 'running',
        total: 0,
        done: 0,
        failed: 0,
        diagnostics: [],
      };
      runs.set(exportId, run);

      // Deliberately not awaited: `start` answers with an id so the dialog can show a
      // progress bar, and the run reports through `progress`. A rejection here would
      // otherwise have nobody listening, so it is caught and turned into the run's own
      // state — an export that died is a finished export with a diagnostic, not a silent one.
      void execute(request, run).catch((error: unknown) => {
        // Written down before it is turned into state, because `run.failure` is only ever read
        // by a dialog that is still open: close it, or export from a window that then quits,
        // and the only record of a dead render was gone (TYTO-132).
        options.log?.error('export failed', error);
        run.status = 'finished';
        run.failure = error instanceof Error ? error.message : String(error);
      });

      return { exportId };
    },

    progress(exportId: string): ExportProgress | undefined {
      const run = runs.get(exportId);
      if (run === undefined) return undefined;
      return {
        status: run.status,
        directory: run.directory,
        total: run.total,
        done: run.done,
        failed: run.failed,
        ...(run.result === undefined ? {} : { result: run.result }),
        ...(run.failure === undefined ? {} : { failure: run.failure }),
        diagnostics: run.diagnostics,
      };
    },

    cancel(exportId: string): void {
      runs.get(exportId)?.controller.abort();
    },
  };
}
