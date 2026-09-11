import { type AssetRef, type Diagnostics, hasErrors } from '@tyto/core';
import {
  type ExportResources,
  type RenderResult,
  fileAssetResolver,
  fileResources,
  fsTaskOutput,
  renderResult,
} from '@tyto/io';
import { type OutputRequest, runJob } from '@tyto/pipeline';
import type { Rasterizer } from '@tyto/raster';

import { activateBuiltIns } from './plugins/index.js';
import { type RenderContext, templateWiring } from './render-context.js';
import { registerOrigin } from './report.js';

/**
 * One brief, start to finish: the job, the artifacts, and the `result.json` beside them.
 *
 * The half of ADR 0011 Tyto owns. `tyto render` calls it once and `tyto watch` calls it
 * per task, and neither has its own idea of what the output folder looks like — which is
 * the point, because a task rendered by the watcher and the same task rendered by hand
 * have to produce the same folder.
 */

export interface RenderTask {
  /** The folder name for a watched task, the brief's own name for a one-off render. */
  readonly id: string;
  readonly brief: string;
  /** As the user should read it, for the `file:line:col` of a diagnostic. */
  readonly briefPath: string;
  /** What relative asset paths in the brief resolve against. */
  readonly assetBase: string;
  /** Where the artifacts and `result.json` go. Created if it is not there. */
  readonly outDirectory: string;
}

export interface RenderTaskOptions {
  readonly outputs: readonly OutputRequest[];
  readonly template?: string;
  readonly formats?: readonly string[];
  readonly rasterizer?: Rasterizer;
  readonly concurrency?: number;
  readonly signal?: AbortSignal;
  /** `tyto`'s own version, for `result.json`'s `tyto.version`. */
  readonly version: string;
}

export interface RenderTaskReport {
  /** Everything the run produced, errors and warnings together. */
  readonly diagnostics: Diagnostics;
  /** The document that was written, so a caller can print it without reading it back. */
  readonly result: RenderResult;
  /** False when anything in `diagnostics` is an error, which is what exit 1 means. */
  readonly ok: boolean;
}

/** The two asset sources a render has, asked in the order that makes a template overridable. */
function combine(brief: ExportResources, template: ExportResources): ExportResources {
  const asset = (ref: AssetRef): string | undefined =>
    brief.html?.asset?.(ref) ?? template.html?.asset?.(ref);
  return { html: { asset }, svg: { asset } };
}

export async function renderTask(
  context: RenderContext,
  task: RenderTask,
  options: RenderTaskOptions,
  /** Diagnostics the context itself produced — a broken template folder, say. */
  inherited: Diagnostics = [],
): Promise<RenderTaskReport> {
  const wiring = templateWiring(context);
  const output = await fsTaskOutput(task.outDirectory, { label: task.id });

  // Per task, because an exporter binds the bytes of the folder it is rendering: two tasks
  // in a `tyto watch` have different `assets/`, and an exporter bound to the wrong one
  // would embed the wrong logo (ADR 0007 — every built-in through the same door).
  const host = activateBuiltIns({
    resources: combine(await fileResources({ base: task.assetBase }), wiring.resources),
    ...(options.rasterizer === undefined ? {} : { rasterizer: options.rasterizer }),
  });

  const registered = host.registry.rasterizers<Rasterizer>()[0]?.value;

  const job = await runJob(
    {
      brief: task.brief,
      outputs: options.outputs,
      ...(options.template === undefined ? {} : { template: options.template }),
      ...(options.formats === undefined ? {} : { formats: options.formats }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    },
    {
      registry: context.registry,
      templates: wiring.source,
      assets: fileAssetResolver({ base: task.assetBase }),
      exporters: host.registry.exporters,
      formats: context.formats,
      // Read back out of the registry rather than passed through: what renders is what was
      // registered, which is the claim the extension point makes.
      ...(registered === undefined ? {} : { rasterizer: registered }),
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      sink: output,
    },
  );

  const produced = job.ok ? job.warnings : job.error;
  // The brief is what a range indexes unless something more specific claimed it — which
  // `templateWiring` already did for the template's own diagnostics.
  registerOrigin(produced, { path: task.briefPath, source: task.brief });

  const diagnostics = [...inherited, ...produced];
  const result = renderResult({
    cancelled: job.ok ? job.value.cancelled : false,
    planned: job.ok ? job.value.planned : 0,
    artifacts: job.ok ? job.value.artifacts : [],
    diagnostics,
    version: options.version,
    templates: context.templateVersions,
  });

  // Written even for a failed run: `result.json` is the only thing the other side of ADR
  // 0011 reads, and a task that produced nothing but errors has to say so in the one file
  // its reader is watching for. A throw here is an internal failure — the document we
  // were about to write does not match its own schema — and is left to escape.
  await output.finish(result);

  return { diagnostics, result, ok: !hasErrors(diagnostics) };
}
