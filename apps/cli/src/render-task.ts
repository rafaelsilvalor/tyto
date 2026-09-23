import { type AssetRef, type Diagnostics, createFaceCache, hasErrors } from '@tyto/core';
import { bundledFont, bundledFontSource } from '@tyto/fonts';
import {
  type ExportResources,
  type RenderResult,
  fileAssetResolver,
  fileResources,
  fsDeliveryOutput,
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
  /**
   * When present, {@link outDirectory} is the **parent** and this names the folder inside it.
   *
   * The delivery layout of `tyto render --folder` (TYTO-121): artwork at the top of
   * `<outDirectory>/<name>/`, the brief and `result.json` under `editaveis/`. Absent is the
   * ADR 0011 contract, where `--out` is the output folder and nothing is nested — and absent
   * is what `tyto watch` and Jacurutu always pass, which is why this is an extra field rather
   * than a change to the one above.
   */
  readonly delivery?: { readonly name: string };
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

/**
 * The faces `compile` measures text against, so it decides the line breaks and resolves an
 * `overflow: 'shrink'` into the runs (ADR 0019).
 *
 * Without them `compile` skips measurement entirely: a shrink reaches `export-html` as
 * `W_EXPORT_APPROXIMATED` and is clipped, and `W_TEXT_OVERFLOW` is never raised — while
 * the desktop preview, which does pass them, measures the same brief. Measured for
 * TYTO-173. One cache for the process, because the bundled faces never change under it.
 */
const faces = createFaceCache(bundledFontSource);

/**
 * Everything an exporter can be asked for, from the places that have it.
 *
 * Two asset sources, asked in the order that makes a template overridable — the brief's own
 * folder first, the template's `src=` files behind it.
 *
 * And one font source, which has no such order because there is only one: the faces Tyto
 * ships (ADR 0021). A brief's own font file is not loaded by anything yet, and
 * `bundledFont` refuses a `FontRef { source: 'file' }` rather than answering it with a
 * bundled face of the same family — so that stays `E_EXPORT_FONT_UNRESOLVED` naming the
 * face, which is the honest answer until something loads one.
 *
 * This is the composition root, which is the whole reason the wiring is here and not in a
 * stage (ADR 0010). `@tyto/fonts` is a Node adapter; `pipeline` and the exporters know only
 * the ports.
 */
function combine(brief: ExportResources, template: ExportResources): ExportResources {
  const asset = (ref: AssetRef): string | undefined =>
    brief.html?.asset?.(ref) ?? template.html?.asset?.(ref);
  return { html: { asset, font: bundledFont }, svg: { asset, font: bundledFont } };
}

export async function renderTask(
  context: RenderContext,
  task: RenderTask,
  options: RenderTaskOptions,
  /** Diagnostics the context itself produced — a broken template folder, say. */
  inherited: Diagnostics = [],
): Promise<RenderTaskReport> {
  const wiring = templateWiring(context);
  // Typed as the wider one where there is one, because the template it used is only known
  // once the job has run and `TaskOutput` has nowhere to put that.
  const delivery =
    task.delivery === undefined
      ? undefined
      : await fsDeliveryOutput(task.outDirectory, {
          name: task.delivery.name,
          // The source this run actually compiled, not a second read of the file. A brief
          // edited between the read and the copy would otherwise put text in `editaveis/`
          // that did not produce the artwork beside it, which is the one thing the folder
          // exists to promise.
          brief: new TextEncoder().encode(task.brief),
          label: task.id,
        });
  const output = delivery ?? (await fsTaskOutput(task.outDirectory, { label: task.id }));

  // Handed out empty and filled by `loadResources` below, once the scene says which files
  // it draws. The folder is no longer read to find out (TYTO-62).
  const briefResources = fileResources({ base: task.assetBase });

  // Per task, because an exporter binds the bytes of the folder it is rendering: two tasks
  // in a `tyto watch` have different `assets/`, and an exporter bound to the wrong one
  // would embed the wrong logo (ADR 0007 — every built-in through the same door).
  const host = activateBuiltIns({
    resources: combine(briefResources, wiring.resources),
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
      faces,
      // Read back out of the registry rather than passed through: what renders is what was
      // registered, which is the claim the extension point makes.
      ...(registered === undefined ? {} : { rasterizer: registered }),
      // Runs between `compile` and the first export: the one moment where the scene exists
      // and nothing has asked an exporter for bytes yet. The template's own `src=` files
      // are not loaded here — `templateWiring` reads that folder when it loads the
      // template, which is already after the brief named it.
      loadResources: briefResources.load,
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      sink: output,
    },
  );

  const produced = job.ok ? job.diagnostics : job.error;
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

  // Before `finish`, so `result.json` is still the last file to appear. A run that never
  // loaded a template names none — a brief that does not parse has no template to point at,
  // and inventing one would be the delivery claiming something the run did not do.
  if (delivery !== undefined && job.ok && job.value.template !== undefined) {
    const { name, version, description } = job.value.template;
    await delivery.describeTemplate({
      name,
      version,
      ...(description === undefined ? {} : { description }),
    });
  }

  // Written even for a failed run: `result.json` is the only thing the other side of ADR
  // 0011 reads, and a task that produced nothing but errors has to say so in the one file
  // its reader is watching for. A throw here is an internal failure — the document we
  // were about to write does not match its own schema — and is left to escape.
  await output.finish(result);

  return { diagnostics, result, ok: !hasErrors(diagnostics) };
}
