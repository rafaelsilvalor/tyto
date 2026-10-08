import { type Diagnostics, createFaceCache, describeFace, hasErrors } from '@tyto/core';
import { createFontLibrary } from '@tyto/fonts';
import {
  type ExportResources,
  type RenderResult,
  briefAssetResolver,
  fileAssetResolver,
  fileResources,
  fsDeliveryOutput,
  fsTaskOutput,
  layeredExportResources,
  recordingAssetResolver,
  renderResult,
} from '@tyto/io';
import { type OutputRequest, fontSubstitutionWarnings, runJob } from '@tyto/pipeline';
import { directiveResolverOf } from '@tyto/plugin-api';
import type { Rasterizer } from '@tyto/raster';

import {
  type LoadedPlugins,
  NO_PLUGINS,
  activateBuiltIns,
  activateInstalled,
} from './plugins/index.js';
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
  /**
   * The brief's folder. Asset paths resolve from it as written, then from `assets/` beside
   * it (ADR 0056), unless {@link assetsOverride} says otherwise.
   */
  readonly briefDirectory: string;
  /**
   * `tyto render --assets <dir>`: the one folder asset paths resolve against, with no
   * fallback. The person named where the files are, so nothing else is searched.
   */
  readonly assetsOverride?: string;
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
  /**
   * Remove what the previous run in {@link outDirectory} listed and this one did not
   * produce (ADR 0054's rule). `tyto watch` sets it, because its `outbox/<id>/out/` is the
   * folder the desktop queue already tidies (ADR 0059, ADR 0060); `tyto render --out` does
   * not, because that folder belongs to the caller and `--out` removes nothing, ever. A
   * `--folder` delivery always removes, so this is ignored there.
   */
  readonly removeLeftovers?: boolean;
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
  /** Installed plugins, imported once per process and activated into every task's host. */
  readonly plugins?: LoadedPlugins;
}

export interface RenderTaskReport {
  /** Everything the run produced, errors and warnings together. */
  readonly diagnostics: Diagnostics;
  /**
   * The document that was written, so a caller can print it without reading it back — or,
   * when a file held the delivery folder, the one there was nowhere to write.
   */
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
 *
 * Bundled and installed faces through one library (ADR 0037), so a `system` face the
 * machine lacks is measured and drawn in the same substitute. The machine's font folders
 * are read once per process: a face installed while `tyto watch` runs is seen on restart.
 */
const fonts = createFontLibrary({ describe: describeFace });
const faces = createFaceCache(fonts.source);

/**
 * Everything an exporter can be asked for, from the places that have it.
 *
 * Two asset sources, asked in the order that makes a template overridable — the brief's own
 * folder first, the template's `src=` files behind it.
 *
 * And one font library: the faces Tyto ships (ADR 0021) and the ones this machine has
 * installed (ADR 0037). A brief's own font file is not loaded by anything yet, and the
 * library refuses a `FontRef { source: 'file' }` rather than answering it with a face of the
 * same family — so that stays `E_EXPORT_FONT_UNRESOLVED` naming the face, which is the
 * honest answer until something loads one.
 *
 * This is the composition root, which is the whole reason the wiring is here and not in a
 * stage (ADR 0010). `@tyto/fonts` is a Node adapter; `pipeline` and the exporters know only
 * the ports.
 */
function exportResources(brief: ExportResources, template: ExportResources): ExportResources {
  // The window binds the same two layers through the same function, so a field one program
  // forgot could not reach only one of them again (TYTO-215, TYTO-216).
  const layered = layeredExportResources([brief, template]);
  const font = fonts.font;
  return { html: { ...layered.html, font }, svg: { ...layered.svg, font } };
}

/**
 * A `--folder` delivery whose folder a file is holding: nothing rendered and nothing written,
 * not even `result.json`, because there is nowhere to write it. Exit 1 and not 2, because
 * the same invocation fails the same way until somebody moves the file (TYTO-129).
 */
function blockedReport(
  blocked: Diagnostics,
  inherited: Diagnostics,
  options: RenderTaskOptions,
): RenderTaskReport {
  const diagnostics = [...inherited, ...blocked];
  const result = renderResult({
    cancelled: false,
    planned: 0,
    artifacts: [],
    diagnostics,
    version: options.version,
    templates: [],
  });
  return { diagnostics, result, ok: false };
}

export async function renderTask(
  context: RenderContext,
  task: RenderTask,
  options: RenderTaskOptions,
  /** Diagnostics the context itself produced — a broken template folder, say. */
  inherited: Diagnostics = [],
): Promise<RenderTaskReport> {
  const wiring = templateWiring(context, {
    outlines: (face) => fonts.source.outlines(face),
    fromMachine: (face) => fonts.fromMachine(face),
  });
  // Typed as the wider one where there is one, because the template it used is only known
  // once the job has run and `TaskOutput` has nowhere to put that.
  const opened =
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
  if (opened !== undefined && !opened.ok) return blockedReport(opened.error, inherited, options);
  const delivery = opened?.value;
  const output =
    delivery ??
    (await fsTaskOutput(task.outDirectory, {
      label: task.id,
      removeLeftovers: task.removeLeftovers ?? false,
    }));

  // Handed out empty and filled by `loadResources` below, once the scene says which files
  // it draws. The folder is no longer read to find out (TYTO-62).
  const assetFolder = task.assetsOverride ?? task.briefDirectory;
  const briefResources = fileResources({ base: assetFolder });

  // Per task, because an exporter binds the bytes of the folder it is rendering: two tasks
  // in a `tyto watch` have different `assets/`, and an exporter bound to the wrong one
  // would embed the wrong logo (ADR 0007 — every built-in through the same door).
  const host = activateBuiltIns({
    resources: exportResources(briefResources, wiring.resources),
    ...(options.rasterizer === undefined ? {} : { rasterizer: options.rasterizer }),
  });
  // After the built-ins, so a built-in keeps every id it has. A plugin refused here is a
  // warning in this task's `result.json`, and the task renders without it (ADR 0040).
  const pluginWarnings = activateInstalled(host, options.plugins ?? NO_PLUGINS);

  const registered = host.registry.rasterizers<Rasterizer>()[0]?.value;
  // Every kit the built-ins and the installed plugins registered, one per brand (ADR 0063).
  // Read from this task's host, which holds the same plugins the task renders with: a
  // plugin refused here offers no kit either. A brand two plugins offer is a warning in
  // this task's `result.json`.
  const brandKits = host.registry.brandKitsByBrand();

  // Recorded as the brief resolves, so a `--folder` delivery copies into `assets/` exactly
  // the files the artwork was drawn from (ADR 0057). `--out` never reads the record.
  const assets = recordingAssetResolver(
    task.assetsOverride === undefined
      ? briefAssetResolver({ briefDirectory: task.briefDirectory })
      : fileAssetResolver({ base: task.assetsOverride }),
  );

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
      assets: assets.resolver,
      exporters: host.registry.exporters,
      directives: directiveResolverOf(() => host.registry.directives()),
      formats: context.formats,
      faces,
      brandKits: brandKits.kits,
      // Read back out of the registry rather than passed through: what renders is what was
      // registered, which is the claim the extension point makes.
      ...(registered === undefined ? {} : { rasterizer: registered }),
      // Runs between `compile` and the first export: the one moment where the scene exists
      // and nothing has asked an exporter for bytes yet. The template's own `src=` files
      // are not loaded here — `templateWiring` reads that folder when it loads the
      // template, which is already after the brief named it.
      loadResources: async (needed) => {
        await briefResources.load(needed);
        return fontSubstitutionWarnings(fonts.substitutions(needed.faces));
      },
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      sink: output,
    },
  );

  const produced = job.ok ? job.diagnostics : job.error;
  // The brief is what a range indexes unless something more specific claimed it — which
  // `templateWiring` already did for the template's own diagnostics.
  registerOrigin(produced, { path: task.briefPath, source: task.brief });

  const artifacts = job.ok ? job.value.artifacts : [];
  // A `--folder` delivery and a watched task remove what their last run left; `--out` was
  // opened without the rule and answers nothing, because its reader reconciles against
  // `result.json` itself (ADR 0054, ADR 0060).
  const leftovers = await output.removeLeftovers({
    artifacts,
    planned: job.ok ? job.value.planned : 0,
    cancelled: job.ok ? job.value.cancelled : false,
    failed: hasErrors([...inherited, ...produced]),
  });

  // Before `result.json`, whose warnings include what it removed from `assets/`.
  const delivered = delivery === undefined ? [] : await delivery.deliverAssets(assets.delivered());

  // Before `finish`, so `result.json` is still the last file to appear, and before the result
  // is built, because a folder holding `template.txt` is an error that belongs in it. A run
  // that never loaded a template names none — a brief that does not parse has no template to
  // point at, and inventing one would be the delivery claiming something the run did not do.
  const described =
    delivery !== undefined && job.ok && job.value.template !== undefined
      ? await delivery.describeTemplate({
          name: job.value.template.name,
          version: job.value.template.version,
          ...(job.value.template.description === undefined
            ? {}
            : { description: job.value.template.description }),
        })
      : [];

  const diagnostics = [
    ...inherited,
    ...pluginWarnings,
    ...brandKits.diagnostics,
    ...produced,
    ...leftovers,
    ...delivered,
    ...described,
  ];
  const resultOf = (listed: Diagnostics): RenderResult =>
    renderResult({
      cancelled: job.ok ? job.value.cancelled : false,
      planned: job.ok ? job.value.planned : 0,
      artifacts,
      diagnostics: listed,
      version: options.version,
      templates: context.templateVersions,
    });
  const result = resultOf(diagnostics);

  // Written even for a failed run: `result.json` is the only thing the other side of ADR
  // 0011 reads, and a task that produced nothing but errors has to say so in the one file
  // its reader is watching for. A throw here is an internal failure — the document we
  // were about to write does not match its own schema — and is left to escape. A folder
  // holding the name is answered instead (TYTO-243): it is reported here, exit 1, because
  // the file it would have gone in is the one that was not written.
  const unwritten = await output.finish(result);
  if (unwritten.length > 0) {
    const reported = [...diagnostics, ...unwritten];
    return { diagnostics: reported, result: resultOf(reported), ok: false };
  }

  return { diagnostics, result, ok: !hasErrors(diagnostics) };
}
