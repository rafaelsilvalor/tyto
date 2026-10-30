import { join } from 'node:path';

import {
  type Diagnostics,
  type FaceCache,
  type TemplateManifest,
  createFaceCache,
  describeFace,
  hasErrors,
} from '@tyto/core';
import { type FontLibrary, createFontLibrary, systemFontDirectories } from '@tyto/fonts';
import {
  GOOGLE_FONTS_ID,
  type GoogleFontsOptions,
  familyKey,
  googleFontWarnings,
} from '@tyto/google-fonts';
import {
  type ExportResources,
  type RenderResult,
  briefAssetResolver,
  fileAssetResolver,
  fileResources,
  fsArtworkOutput,
  fsTaskOutput,
  layeredExportResources,
  renderResult,
  sourceCache,
} from '@tyto/io';
import {
  type LoadedResources,
  type OutputRequest,
  type TemplateSource,
  fontSubstitutionWarnings,
  runJob,
} from '@tyto/pipeline';
import { type HostCapabilities, directiveResolverOf } from '@tyto/plugin-api';
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
  /**
   * The brief's workspace's asset folders (TYTO-278), searched after the brief's own folder
   * and its `assets/`. Ignored with {@link assetsOverride}, which searches one folder only.
   */
  readonly projectAssets?: readonly string[];
  /** Where the artifacts and `result.json` go. Created if it is not there. */
  readonly outDirectory: string;
  /**
   * When present, {@link outDirectory} is the **parent** and this names the folder inside it.
   *
   * `tyto render --folder` (TYTO-121): the artwork alone in `<outDirectory>/<name>/`, with no
   * `result.json`, brief or `assets/` beside it (ADR 0157, TYTO-490). Absent is the ADR 0011
   * contract, where `--out` is the output folder, nothing is nested and `result.json` is
   * written — and absent is what `tyto watch` and Jacurutu always pass, which is why this is
   * an extra field rather than a change to the one above.
   */
  readonly folder?: { readonly name: string };
  /**
   * Remove what the previous run in {@link outDirectory} listed and this one did not
   * produce (ADR 0054's rule). `tyto watch` sets it, because its `outbox/<id>/out/` is the
   * folder the desktop queue already tidies (ADR 0059, ADR 0060); `tyto render --out` does
   * not, because that folder belongs to the caller and `--out` removes nothing, ever.
   * Ignored with {@link folder}, which keeps no report to tell Tyto's files apart.
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
  /**
   * The brief's workspace's font folders (TYTO-278), searched before this machine's own, so a
   * project's face wins over an installed one of the same family.
   */
  readonly fontDirectories?: readonly string[];
  /**
   * Where a plugin's `asset-source` and `font-source` answers are kept, and whether a miss
   * may ask them (ADR 0117, ADR 0118). Absent when there is no `TYTO_HOME`, which also
   * means no installed plugin: a plugin reference is then a file that is not there.
   */
  readonly sources?: TaskSources;
  /**
   * The Google Fonts `font-source` (ADR 0120), on when present; `googleFontsFor` decides it
   * from the flag and the environment.
   */
  readonly googleFonts?: GoogleFontsOptions;
  /** `host.fetch` for a built-in that reaches the network — Google Fonts. */
  readonly capabilities?: HostCapabilities;
}

export interface TaskSources {
  /** `TYTO_HOME`; the cache is `cache/sources/` inside it. */
  readonly home: string;
  /** False for a restricted folder and for `tyto watch`: the cache is read, nothing fetched. */
  readonly fetches: boolean;
  /** What a miss says when {@link fetches} is false. The restricted folder's reason by default. */
  readonly notFetchedBecause?: string;
  /** Each plugin's section of the brief's resolved project (ADR 0112), handed on each fetch. */
  readonly sections?: Readonly<Record<string, unknown>>;
}

export interface RenderTaskReport {
  /** Everything the run produced, errors and warnings together. */
  readonly diagnostics: Diagnostics;
  /**
   * The document that was written, so a caller can print it without reading it back — or,
   * for `--folder`, the one that is printed and not written, and when a file held that
   * folder, the one there was nowhere to write.
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
const machineFonts = createFontLibrary({ describe: describeFace });
const machineFaces = createFaceCache(machineFonts.source);

/**
 * A library per set of workspace font folders, kept for the process like the machine's: a
 * `tyto watch` renders every task of one workspace against the same folders.
 */
const projectFonts = new Map<string, TaskFonts>();

export interface TaskFonts {
  readonly fonts: FontLibrary;
  /** Replaced, not cleared, when a plugin adds a face: it remembers every face it was asked. */
  faces: FaceCache;
}

const machine: TaskFonts = { fonts: machineFonts, faces: machineFaces };

/**
 * The library for a workspace's font folders and for the source cache's (ADR 0117), in that
 * order around this machine's: a project's face wins over an installed one, and **an
 * installed one over a plugin's**, so a render offline draws what it drew online.
 */
export function fontsFor(
  directories: readonly string[] | undefined,
  sourceDirectories: readonly string[] = [],
): TaskFonts {
  const project = directories ?? [];
  if (project.length === 0 && sourceDirectories.length === 0) return machine;
  const key = JSON.stringify([project, sourceDirectories]);
  const known = projectFonts.get(key);
  if (known !== undefined) return known;
  const fonts = createFontLibrary({
    describe: describeFace,
    directories: [...project, ...systemFontDirectories(), ...sourceDirectories],
  });
  const built: TaskFonts = { fonts, faces: createFaceCache(fonts.source) };
  projectFonts.set(key, built);
  return built;
}

/**
 * After a font source wrote a face: the library lists its folders again, and a new face
 * cache measures with it. The old cache answered that face with its substitute.
 */
function refreshFonts(fonts: TaskFonts): FaceCache {
  fonts.fonts.refresh();
  fonts.faces = createFaceCache(fonts.fonts.source);
  return fonts.faces;
}

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
function exportResources(
  brief: ExportResources,
  template: ExportResources,
  fonts: () => FontLibrary,
): ExportResources {
  // The window binds the same two layers through the same function, so a field one program
  // forgot could not reach only one of them again (TYTO-215, TYTO-216).
  const layered = layeredExportResources([brief, template]);
  // Read when an exporter asks, because the library is chosen after the host that holds the
  // exporters: its last folders are the font sources' that host's plugins registered.
  const font: FontLibrary['font'] = (face) => fonts().font(face);
  return { html: { ...layered.html, font }, svg: { ...layered.svg, font } };
}

/**
 * A `--folder` render whose folder a file is holding: nothing rendered and nothing written,
 * because there is nowhere to write it. Exit 1 and not 2, because
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
  // Settled once the host exists, below; nothing reads it before the job runs.
  let taskFonts = fontsFor(options.fontDirectories);
  const wiring = templateWiring(context, {
    outlines: (face) => taskFonts.fonts.source.outlines(face),
    fromMachine: (face) => taskFonts.fonts.fromMachine(face),
  });
  // `--folder` writes the artwork alone (ADR 0157); everything else keeps the contract's
  // `result.json` beside it (ADR 0011).
  const opened =
    task.folder === undefined
      ? undefined
      : await fsArtworkOutput(join(task.outDirectory, task.folder.name), { label: task.id });
  if (opened !== undefined && !opened.ok) return blockedReport(opened.error, inherited, options);
  const output =
    opened?.value ??
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
    resources: exportResources(briefResources, wiring.resources, () => taskFonts.fonts),
    ...(options.rasterizer === undefined ? {} : { rasterizer: options.rasterizer }),
    ...(options.googleFonts === undefined ? {} : { googleFonts: options.googleFonts }),
    ...(options.capabilities === undefined ? {} : { capabilities: options.capabilities }),
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

  // A plugin's images and faces, fetched once into `TYTO_HOME` and read from there (ADR 0117).
  const sources = options.sources;
  const cache =
    sources === undefined
      ? undefined
      : sourceCache({
          home: sources.home,
          assetSources: () => host.registry.assetSources(),
          fontSources: () => host.registry.fontSources(),
          sectionOf: (plugin) => sources.sections?.[plugin],
          fetches: sources.fetches,
          ...(sources.notFetchedBecause === undefined
            ? {}
            : { notFetchedBecause: sources.notFetchedBecause }),
        });
  if (cache !== undefined) taskFonts = fontsFor(options.fontDirectories, cache.fontDirectories());
  const fonts = taskFonts;

  const files =
    task.assetsOverride === undefined
      ? briefAssetResolver({
          briefDirectory: task.briefDirectory,
          ...(task.projectAssets === undefined ? {} : { projectAssets: task.projectAssets }),
        })
      : fileAssetResolver({ base: task.assetsOverride });
  const assets = cache === undefined ? files : cache.assets(files);

  // The template the job loads, kept for the one question only its manifest answers: which
  // free families stand in for a face nobody can supply (ADR 0120).
  let loaded: TemplateManifest | undefined;
  const templates: TemplateSource = {
    load: async (name) => {
      const answer = await wiring.source.load(name);
      if (answer.ok) loaded = answer.value.manifest;
      return answer;
    },
  };
  // One line per missing face: with Google Fonts on, a family it does not serve is
  // `W_FONT_UNAVAILABLE` in place of `W_FONT_SUBSTITUTED`; off, exactly as before.
  const missingFaceWarnings = (substitutions: Parameters<typeof fontSubstitutionWarnings>[0]) =>
    options.googleFonts === undefined
      ? fontSubstitutionWarnings(substitutions)
      : googleFontWarnings(
          substitutions,
          (family) => loaded?.fonts?.[family]?.alternatives,
          (family) =>
            host.registry
              .fontSources()
              .some(
                ({ plugin, source }) =>
                  plugin !== GOOGLE_FONTS_ID &&
                  source.families.some((name) => familyKey(name) === familyKey(family)),
              ),
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
      configurations: context.configurations,
      templates,
      assets,
      exporters: host.registry.exporters,
      directives: directiveResolverOf(() => host.registry.directives()),
      formats: context.formats,
      faces: fonts.faces,
      brandKits: brandKits.kits,
      // Read back out of the registry rather than passed through: what renders is what was
      // registered, which is the claim the extension point makes.
      ...(registered === undefined ? {} : { rasterizer: registered }),
      // Runs between `compile` and the first export: the one moment where the scene exists
      // and nothing has asked an exporter for bytes yet. The template's own `src=` files
      // are not loaded here — `templateWiring` reads that folder when it loads the
      // template, which is already after the brief named it.
      // A face no local folder has is asked of a font source here; when one arrived, the job
      // compiles once more against it, because the first pass measured its substitute.
      loadResources: async (needed): Promise<LoadedResources> => {
        await briefResources.load(needed);
        const missing = fonts.fonts.substitutions(needed.faces);
        const fetched = await cache?.fetchFaces(missing.map(({ requested }) => requested));
        if (fetched !== undefined && fetched.fetched > 0) {
          const faces = refreshFonts(fonts);
          // Asked again after the refresh: the job keeps these only when it does not compile
          // again, which is a second request, and then they must describe what is drawn.
          const still = fonts.fonts.substitutions(needed.faces);
          return {
            diagnostics: [...missingFaceWarnings(still), ...fetched.diagnostics],
            recompile: { faces },
          };
        }
        return {
          diagnostics: [...missingFaceWarnings(missing), ...(fetched?.diagnostics ?? [])],
        };
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
  // A watched task removes what its last run left; `--out` was opened without the rule and
  // answers nothing, because its reader reconciles against `result.json` itself (ADR 0054,
  // ADR 0060), and `--folder` keeps no report to tell Tyto's files apart (ADR 0157).
  const leftovers = await output.removeLeftovers({
    artifacts,
    planned: job.ok ? job.value.planned : 0,
    cancelled: job.ok ? job.value.cancelled : false,
    failed: hasErrors([...inherited, ...produced]),
  });

  const diagnostics = [
    ...inherited,
    ...pluginWarnings,
    ...brandKits.diagnostics,
    ...produced,
    ...leftovers,
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

  // Written even for a failed run, except under `--folder`, which writes none (ADR 0157):
  // `result.json` is the only thing the other side of ADR 0011 reads, and a task that produced nothing but errors has to say so in the one file
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
