import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

import {
  type Diagnostics,
  type Trust,
  builtInDelivery,
  deliveryOfBrief,
  planDelivery,
} from '@tyto/core';
import { type RecipeRunner, createDelivery, createRecipeRunner } from '@tyto/io';
import type { RecipeContributions } from '@tyto/plugin-api';
import { systemClock } from '@tyto/recipe';

import type { CliEnvironment, CliRasterizer } from '../environment.js';
import { templateSkeleton } from '../delivery.js';
import { googleFontsOption } from '../google-fonts.js';
import { needsRasterizer, outputRequests, unavailableTypes } from '../options.js';
import {
  NO_PLUGIN_FILES,
  type SyncedPluginFiles,
  leftOutPluginFiles,
  syncPluginFiles,
} from '../plugin-files.js';
import {
  type LoadedPlugins,
  activateBuiltIns,
  activateInstalled,
  loadInstalledPlugins,
  pluginCapabilities,
  reachableExporters,
  withoutRefused,
} from '../plugins/index.js';
import { environmentRecipeCredentials } from '../recipe-credentials.js';
import { type RenderContext, loadRenderContext } from '../render-context.js';
import {
  type RenderTaskReport,
  type TaskSources,
  memoryTaskOutput,
  renderTask,
} from '../render-task.js';
import { displayPath, installedOption } from '../render.js';
import { type LocatedDiagnostic, diagnosticsDocument, registerUnplaced } from '../report.js';
import { optionalSources, projectSections, renderSources } from '../sources.js';
import { type BriefWorkspace, workspaceOfFolder } from '../workspace.js';
import { confinedPath } from './confine.js';
import { type TemplateGuidance, liesInside, readTemplateGuidance } from './guidance.js';
import {
  type RecipeApplyAnswer,
  type RecipeRunAnswer,
  type RecipeSource,
  cellAnswer,
  runAnswer,
} from './recipes.js';
import { PREVIEW_MAX_IMAGES, PREVIEW_MAX_SIDE, ToolRefusal } from './tools.js';
import { type BriefWrite, type BriefWriteAnswer, writeBrief } from './writes.js';

/**
 * What `tyto mcp` holds for as long as the client is connected (ADR 0179): the workspace of the
 * folder it was started in, the plugin files and the installed plugins, loaded once, and a
 * Chromium started on the first preview and closed with the session.
 *
 * Every answer is the CLI's own: the workspace is found as `tyto render` finds a brief's, with
 * the same trust, so a restricted folder withholds its sections and its plugin files here
 * exactly as it does there (ADR 0111). Nothing here writes a file. The SDK is not imported
 * here: this is the part a test drives without a protocol in the way.
 */

/** A brief named by path, confined (see `confine.ts`), or handed over as text. */
export type BriefInput = { readonly path: string } | { readonly text: string };

export interface TemplateSummary {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly formats: readonly string[];
}

export interface CheckAnswer {
  readonly status: 'ok' | 'error';
  readonly diagnostics: readonly LocatedDiagnostic[];
}

export interface PreviewImage {
  readonly artwork: string;
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly png: Uint8Array;
}

export interface PreviewAnswer extends CheckAnswer {
  readonly images: readonly PreviewImage[];
  /** Artworks rendered and not returned, past {@link PREVIEW_MAX_IMAGES}. */
  readonly omitted: number;
}

export interface McpSession {
  /** The workspace's trust; `restricted` outside any workspace, where nothing is trusted. */
  readonly trust: Trust;
  /** The folder the server was started in, and the workspace's when it has one. */
  readonly roots: readonly string[];
  listTemplates(): Promise<readonly TemplateSummary[]>;
  describeTemplate(name: string): Promise<Record<string, unknown>>;
  checkBrief(brief: BriefInput, options?: BriefOptions, signal?: AbortSignal): Promise<CheckAnswer>;
  renderPreview(
    brief: BriefInput,
    options: BriefOptions & { readonly format: string },
    signal?: AbortSignal,
  ): Promise<PreviewAnswer>;
  /**
   * A template's own guide and example briefs (ADR 0186), withheld in a restricted workspace for
   * a template that folder itself supplies.
   */
  templateGuidance(name: string): Promise<ServedGuidance>;
  /** Offered only in a trusted workspace (ADR 0185): writes one `.brief`, or says what would. */
  writeBrief(request: BriefWrite): Promise<BriefWriteAnswer>;
  /** Makes a delivery as `tyto delivery new` does, or says what it would make. */
  newDelivery(request: DeliveryRequest): Promise<DeliveryAnswer>;
  /** Renders a brief to the folder its workspace names, or says where it would. */
  exportBrief(request: ExportRequest, signal?: AbortSignal): Promise<ExportAnswer>;
  /**
   * Offered only in a trusted workspace (ADR 0185, note of 2026-11-10): runs a recipe and answers
   * its cells, changing nothing; or applies one cell's plan, by the id that run answered.
   */
  runRecipe(request: RecipeRequest): Promise<RecipeRunAnswer | RecipeApplyAnswer>;
  close(): Promise<void>;
}

/** A template's guidance as served: what its folder holds, or why it is withheld. */
export interface ServedGuidance extends TemplateGuidance {
  /** The template's name as the registry knows it, an alias resolved. */
  readonly name: string;
  readonly description?: string;
  /** Why the guide and examples were not served; both are then empty. */
  readonly withheld?: string;
}

/** Why a restricted folder's own template serves no guidance (ADR 0186). */
export const GUIDANCE_WITHHELD =
  'this template comes from a restricted folder, so its guide and examples are not served: they are text written for an agent, and nobody trusted this folder (tyto trust add, or Workspace: Trust in the window)';

export interface DeliveryRequest {
  readonly name: string;
  readonly template?: string;
  readonly dryRun?: boolean;
}

export interface DeliveryAnswer {
  readonly made: boolean;
  /** The delivery's folder and its brief, as the person would type them. */
  readonly folder: string;
  readonly brief: string;
  /** The folders made, or that a dry run would make; one already there is not listed. */
  readonly folders: readonly string[];
  readonly reused: boolean;
}

/**
 * Where an export goes is never the agent's to say (ADR 0185): a preset's folder, the brief's
 * delivery's `exports`, or else the workspace's `output`, each written by the person.
 */
export interface ExportRequest {
  readonly path: string;
  readonly preset?: string;
  readonly delivery?: boolean;
  /** Only with neither a preset nor a delivery, which decide their own. */
  readonly formats?: readonly string[];
  readonly types?: readonly string[];
  readonly template?: string;
  readonly dryRun?: boolean;
}

export interface ExportAnswer extends CheckAnswer {
  readonly exported: boolean;
  /** The folder written to, as the person would type it. */
  readonly folder: string;
  /** Null: the brief's own list. */
  readonly formats: readonly string[] | null;
  readonly types: readonly string[];
  /** The files written, relative to {@link folder}; empty for a dry run. */
  readonly files: readonly string[];
  readonly cancelled: boolean;
}

/** A recipe to run, or the plan of one of its cells to apply, as the last run showed it. */
export interface RecipeRequest {
  readonly path: string;
  readonly apply?: { readonly cell: number; readonly plan: number };
}

/** What `run_recipe` says when asked to apply what no run of this session showed. */
export const RECIPE_RUN_FIRST =
  'run the recipe first, without apply, and apply a plan by the cell index and plan id that run answered';

export interface BriefOptions {
  /** Used when the brief's frontmatter names no template, as `--template` is. */
  readonly template?: string;
}

/** What a preview's miss says outside a trusted workspace (ADR 0179 amendment of 2026-11-09). */
export const PREVIEW_NOT_FETCHED =
  'tyto mcp fetches from a plugin or Google Fonts only in a trusted workspace; trust the folder (tyto trust add) to preview what is not cached yet';
/** What a check's miss says: it never fetches (ADR 0179 decision 2). */
export const CHECK_NOT_FETCHED =
  'check_brief fetches nothing; render_preview in a trusted workspace fetches what is not cached';

/** Where an export writes, from the workspace's own configuration (ADR 0185). */
interface ExportTo {
  readonly directory: string;
  readonly types: readonly string[];
  readonly formats?: readonly string[];
  /** A delivery's: where `result.json` goes, the brief's folder (ADR 0157 §6). */
  readonly report?: string;
  readonly rasterized: boolean;
}

interface LoadedContext {
  readonly value: RenderContext;
  readonly diagnostics: Diagnostics;
}

/** What the server reports for a brief handed over as text. */
const INLINE_BRIEF = '<inline brief>';

const messagesOf = (problems: Diagnostics): string =>
  problems.map((problem) => problem.message).join('\n');

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export interface SessionOptions {
  /** Why a brief may not be replaced now, when a window holds it (ADR 0185 decision 4). */
  readonly heldOpen?: (path: string) => Promise<string | undefined>;
  /**
   * The recipe verbs `run_recipe` runs with, in place of the installed plugins'. For a test: no
   * generic verb starts a table, so a recipe that reads anything needs a source, and a test's is
   * handed here rather than installed as a plugin process.
   */
  readonly recipeContributions?: RecipeContributions;
}

export async function openSession(
  environment: CliEnvironment,
  sessionOptions: SessionOptions = {},
): Promise<McpSession> {
  const { heldOpen } = sessionOptions;
  const { cwd } = environment;
  const shown = (path: string): string => displayPath(cwd, path);
  const workspace: BriefWorkspace | undefined = await workspaceOfFolder(
    cwd,
    {},
    environment,
    shown,
  );
  const project = workspace?.loaded.project;
  const trust: Trust = workspace?.loaded.trust ?? 'restricted';
  const roots = workspace === undefined ? [cwd] : [cwd, workspace.loaded.folder];

  // As `tyto render` does: the plugin files first, never moving a pinned ref and never asking,
  // and a restricted folder's own plugin files left out with the reason on stderr.
  const pluginFilesWorkspace =
    workspace === undefined
      ? undefined
      : { folder: workspace.loaded.folder, trusted: workspace.loaded.trust === 'trusted' };
  const pluginFiles: SyncedPluginFiles =
    environment.home === undefined
      ? NO_PLUGIN_FILES
      : await syncPluginFiles(
          {
            home: environment.home,
            ...(pluginFilesWorkspace === undefined ? {} : { workspace: pluginFilesWorkspace }),
            update: false,
            fetches: true,
            approval: 'never',
          },
          environment,
        );
  registerUnplaced(pluginFiles.diagnostics);
  const leftOut = await leftOutPluginFiles(pluginFilesWorkspace, 'loaded', environment);
  if (leftOut !== '') environment.console.err(leftOut);

  const loaded: LoadedPlugins = await loadInstalledPlugins(environment.home, {
    launch: environment.launch,
    copies: pluginFiles.copies,
    capabilities: pluginCapabilities(environment.variables, {
      hostName: 'tyto mcp',
      ...(environment.home === undefined ? {} : { home: environment.home }),
      workspace:
        workspace === undefined
          ? { trust: 'restricted' }
          : { folder: workspace.loaded.folder, trust: workspace.loaded.trust },
    }),
  });

  /**
   * Read on every call rather than once: an agent edits a template and asks again, and an
   * answer from the folder as it was at start would be the one thing it cannot see past.
   */
  async function context(): Promise<LoadedContext> {
    const answer = await loadRenderContext({
      templatesDirectory: resolve(cwd, 'templates'),
      projectTemplatesDirectories: project?.templates ?? [],
      formatsFile: resolve(cwd, 'formats.yaml'),
      templatesDirectoryIsDefault: true,
      formatsFileIsDefault: true,
      ...installedOption(environment, loaded, pluginFiles),
    });
    if (!answer.ok) {
      throw new ToolRefusal(
        diagnosticsDocument([...pluginFiles.diagnostics, ...answer.error])
          .diagnostics.map((item) => `${item.code} ${item.message}`)
          .join('\n'),
      );
    }
    return {
      value: answer.value,
      diagnostics: [...pluginFiles.diagnostics, ...answer.diagnostics],
    };
  }

  /**
   * Where an export goes (ADR 0185): every answer is a folder the person wrote in a sheet of
   * this trusted workspace, never one the agent names.
   */
  function exportDestination(
    request: ExportRequest,
    briefPath: string,
  ): Omit<ExportTo, 'rasterized'> {
    const decides = request.preset !== undefined || request.delivery === true;
    if (request.preset !== undefined && request.delivery === true) {
      throw new ToolRefusal('give preset or delivery, not both');
    }
    if (decides && (request.formats !== undefined || request.types !== undefined)) {
      throw new ToolRefusal(
        'a preset and a delivery decide their own formats and types; leave them out',
      );
    }
    if (request.preset !== undefined) {
      const preset = project?.exportPresets.find((entry) => entry.name === request.preset);
      if (preset === undefined) {
        const known = (project?.exportPresets ?? []).map((entry) => entry.name);
        throw new ToolRefusal(
          `no export preset '${request.preset}' in this workspace; known: ${known.length === 0 ? 'none' : known.join(', ')}`,
        );
      }
      return { directory: preset.folder, types: preset.types, formats: preset.formats };
    }
    if (request.delivery === true) {
      const layout = project?.delivery ?? builtInDelivery(workspace?.loaded.folder ?? cwd);
      const delivery = deliveryOfBrief(layout, briefPath);
      if (delivery === undefined) {
        throw new ToolRefusal(`${shown(briefPath)} is not the brief of a delivery`);
      }
      return {
        directory: delivery.exports,
        report: delivery.report,
        types: layout.types ?? ['png'],
        ...(layout.formats === undefined ? {} : { formats: layout.formats }),
      };
    }
    if (project?.output === undefined) {
      throw new ToolRefusal(
        "this workspace names no output folder; set 'output' in its project file, or export with a preset or delivery",
      );
    }
    return {
      directory: project.output,
      types: request.types ?? ['png'],
      ...(request.formats === undefined ? {} : { formats: request.formats }),
    };
  }

  /**
   * One recipe runner for the session, made at the first `run_recipe`: it keeps each recipe's
   * cells, so an apply hands the verb the very plan the run showed (ADR 0170 decision 3). Its
   * verbs are the installed plugins', activated into a host of its own as a render's are, minus
   * the ones the render context refused.
   */
  let recipeRunner: Promise<RecipeRunner> | undefined;
  function sessionRecipeRunner(home: string): Promise<RecipeRunner> {
    recipeRunner ??= context().then(({ value }) => {
      const contributions =
        sessionOptions.recipeContributions ??
        (() => {
          const host = activateBuiltIns();
          activateInstalled(host, withoutRefused(loaded, value.refusedPlugins));
          return host.registry;
        })();
      const folder = workspace?.loaded.folder;
      return createRecipeRunner({
        contributions,
        // The tool is offered only in a trusted workspace; anything else is held as restricted.
        placeOf: () =>
          Promise.resolve(folder === undefined ? { trust: 'none' } : { trust, folder }),
        sectionFor: (_directory, plugin) =>
          trust === 'trusted' ? projectSections(workspace?.loaded, {})[plugin] : undefined,
        home,
        clock: () => systemClock,
        templates: async (name) => {
          const current = (await context()).value;
          return current.registry.get(current.configurations.select(name)?.template ?? name);
        },
        // TYTO-671, ADR 0193 decision 8: `call` plans against the workspace's list and the
        // credentials in the environment, and sends nothing: an agent previews a dispatch and
        // never carries one out (ADR 0185).
        calls: {
          hostsFor: () => (trust === 'trusted' ? workspace?.loaded.project.callHosts : undefined),
          credentials: environmentRecipeCredentials(environment.variables ?? {}),
          sends: false,
        },
      });
    });
    return recipeRunner;
  }

  let rasterizer: CliRasterizer | undefined;
  /** One Chromium for the session, started by the first preview (ADR 0179). */
  const sessionRasterizer = (): CliRasterizer => (rasterizer ??= environment.rasterizer());

  async function briefOf(
    input: BriefInput,
  ): Promise<{ readonly source: string; readonly shown: string; readonly directory: string }> {
    if ('text' in input) return { source: input.text, shown: INLINE_BRIEF, directory: cwd };
    const confined = await confinedPath(input.path, cwd, roots);
    if (!confined.ok) throw new ToolRefusal(confined.reason);
    const source = await readFile(confined.path, 'utf8');
    return { source, shown: shown(confined.path), directory: dirname(confined.path) };
  }

  async function run(
    input: BriefInput,
    options: BriefOptions & { readonly format?: string; readonly scale?: number },
    preview: boolean,
    signal: AbortSignal | undefined,
    loadedContext?: LoadedContext,
    exportTo?: ExportTo,
  ): Promise<{ readonly report: RenderTaskReport; readonly answer: CheckAnswer }> {
    const brief = await briefOf(input);
    const { value, diagnostics } = loadedContext ?? (await context());
    const plugins = withoutRefused(loaded, value.refusedPlugins);
    // An export fetches as a preview does: it is offered only in a trusted workspace.
    const fetching = preview || exportTo !== undefined;
    const sources = renderSources(environment.home, workspace?.loaded);
    /**
     * A check fetches nothing: it answers about the brief's structure, not its fonts or its
     * remote images. A preview fetches only in a trusted workspace (ADR 0179 amendment of
     * 2026-11-09), stricter than `tyto render`, which also fetches outside any workspace: there
     * an agent naming references would pull the person's images from a connected service, with
     * their credentials, into its own context, and nothing was trusted. The cache is read
     * either way.
     */
    const sourcesFor = (given: TaskSources, previewing: boolean): TaskSources =>
      previewing && trust === 'trusted'
        ? given
        : {
            ...given,
            fetches: false,
            notFetchedBecause: previewing ? PREVIEW_NOT_FETCHED : CHECK_NOT_FETCHED,
          };
    const report = await renderTask(
      value,
      {
        id: brief.shown,
        brief: brief.source,
        briefPath: brief.shown,
        briefDirectory: brief.directory,
        ...(project === undefined ? {} : { projectAssets: project.assets }),
        assetRoots: [...roots, ...(project?.assets ?? [])],
        ...(exportTo === undefined
          ? { outDirectory: cwd, output: memoryTaskOutput() }
          : {
              outDirectory: exportTo.directory,
              ...(exportTo.report === undefined ? {} : { delivery: { report: exportTo.report } }),
            }),
      },
      {
        // A check exports SVG, which needs no browser; a preview a PNG (ADR 0179 decision 4);
        // an export what its destination says (ADR 0185).
        outputs:
          exportTo !== undefined
            ? outputRequests({ types: exportTo.types })
            : [
                preview
                  ? {
                      kind: 'png',
                      ...(options.scale === undefined ? {} : { scale: options.scale }),
                    }
                  : { kind: 'svg' },
              ],
        version: environment.version,
        plugins,
        ...(options.template === undefined ? {} : { template: options.template }),
        ...(options.format === undefined ? {} : { formats: [options.format] }),
        ...(exportTo?.formats === undefined ? {} : { formats: exportTo.formats }),
        ...(preview ? { rasterizer: sessionRasterizer(), concurrency: 1 } : {}),
        ...(exportTo?.rasterized === true ? { rasterizer: sessionRasterizer() } : {}),
        ...(signal === undefined ? {} : { signal }),
        ...(project === undefined ? {} : { fontDirectories: project.fonts }),
        ...optionalSources(sources === undefined ? undefined : sourcesFor(sources, fetching)),
        ...(fetching ? googleFontsOption(true, environment.variables) : {}),
      },
      diagnostics,
    );
    const document = diagnosticsDocument(report.diagnostics, {
      primary: { path: brief.shown, source: brief.source },
    });
    return { report, answer: { status: document.status, diagnostics: document.diagnostics } };
  }

  return {
    trust,
    roots,

    async listTemplates() {
      const { value } = await context();
      return value.registry.list().map((manifest) => ({
        name: manifest.name,
        version: manifest.version,
        ...(manifest.description === undefined ? {} : { description: manifest.description }),
        formats: manifest.formats,
      }));
    },

    async describeTemplate(name) {
      const { value } = await context();
      const skeleton = templateSkeleton(value, name);
      if (!skeleton.ok) {
        throw new ToolRefusal(skeleton.error.map((item) => item.message).join('\n'));
      }
      const { manifest, formats, text } = skeleton.value;
      return {
        name: manifest.name,
        version: manifest.version,
        ...(manifest.description === undefined ? {} : { description: manifest.description }),
        formats: formats.map((id) => ({
          id,
          ...(value.formats.labelOf(id) === undefined ? {} : { label: value.formats.labelOf(id) }),
          ...(value.formats.sizeOf(id) ?? {}),
        })),
        slots: manifest.slots,
        adjustments: manifest.adjustments,
        skeleton: text,
      };
    },

    async templateGuidance(name) {
      const { value } = await context();
      const skeleton = templateSkeleton(value, name);
      if (!skeleton.ok) {
        throw new ToolRefusal(skeleton.error.map((item) => item.message).join('\n'));
      }
      const { manifest } = skeleton.value;
      const served = {
        name: manifest.name,
        ...(manifest.description === undefined ? {} : { description: manifest.description }),
      };
      const directory = value.registry.directoryOf(manifest.name);
      if (directory === undefined) return { ...served, examples: [], omittedExamples: 0 };
      // The folders this workspace names for templates, and the served folders themselves: a
      // template from any of them is text this folder supplies (ADR 0186).
      const ownFolders = [resolve(cwd, 'templates'), ...(project?.templates ?? []), ...roots];
      if (trust !== 'trusted' && (await liesInside(directory, ownFolders))) {
        return { ...served, examples: [], omittedExamples: 0, withheld: GUIDANCE_WITHHELD };
      }
      return { ...served, ...(await readTemplateGuidance(directory)) };
    },

    async checkBrief(input, options = {}, signal) {
      return (await run(input, options, false, signal)).answer;
    },

    async renderPreview(input, options, signal) {
      const loadedContext = await context();
      const { value } = loadedContext;
      const size = value.formats.sizeOf(options.format);
      if (size === undefined) {
        const known = value.formats.list().map((format) => format.id);
        throw new ToolRefusal(`no format '${options.format}'; known: ${known.join(', ')}`);
      }
      // Never above 1: the ceiling shrinks a large frame and never enlarges a small one.
      const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(size.w, size.h));
      const { report, answer } = await run(
        input,
        { ...options, scale },
        true,
        signal,
        loadedContext,
      );
      const pngs = report.artifacts.filter((artifact) => artifact.kind === 'png');
      return {
        ...answer,
        images: pngs.slice(0, PREVIEW_MAX_IMAGES).map((artifact) => ({
          artwork: artifact.artwork,
          format: artifact.format,
          width: Math.round(size.w * scale),
          height: Math.round(size.h * scale),
          png: artifact.bytes,
        })),
        omitted: Math.max(0, pngs.length - PREVIEW_MAX_IMAGES),
      };
    },

    async writeBrief(request) {
      return writeBrief(request, {
        cwd,
        roots,
        shown,
        ...(heldOpen === undefined ? {} : { heldOpen }),
      });
    },

    async newDelivery(request) {
      // The layout and its root are the trusted workspace's; this tool is offered nowhere else.
      const root = workspace?.loaded.folder ?? cwd;
      const layout = project?.delivery ?? builtInDelivery(root);
      const plan = planDelivery(layout, request.name);
      if (!plan.ok) throw new ToolRefusal(messagesOf(plan.error));
      let brief = '';
      if (request.template !== undefined) {
        const skeleton = templateSkeleton((await context()).value, request.template);
        if (!skeleton.ok) throw new ToolRefusal(messagesOf(skeleton.error));
        brief = skeleton.value.text;
      }
      const wanted = [plan.value.folder, ...plan.value.folders];
      if (request.dryRun === true) {
        const missing: string[] = [];
        for (const folder of wanted) {
          if (!(await exists(folder)) && !missing.includes(folder)) missing.push(folder);
        }
        if (await exists(plan.value.brief)) {
          throw new ToolRefusal(
            `${shown(plan.value.brief)} is already there; a delivery's brief is never overwritten`,
          );
        }
        return {
          made: false,
          folder: shown(plan.value.folder),
          brief: shown(plan.value.brief),
          folders: missing.map(shown),
          reused: !missing.includes(plan.value.folder),
        };
      }
      // `createDelivery` follows every path through `realpath` and refuses one that leads out
      // of the root, and never overwrites a brief (ADR 0157 §3, decision 5).
      const made = await createDelivery(plan.value, { root, brief, shown });
      if (!made.ok) throw new ToolRefusal(messagesOf(made.error));
      return {
        made: true,
        folder: shown(plan.value.folder),
        brief: shown(plan.value.brief),
        folders: made.value.made.map(shown),
        reused: made.value.reused,
      };
    },

    async exportBrief(request, signal) {
      const confined = await confinedPath(request.path, cwd, roots);
      if (!confined.ok) throw new ToolRefusal(confined.reason);
      const briefPath = confined.path;
      const destination = exportDestination(request, briefPath);
      const loadedContext = await context();
      const { exporters } = reachableExporters(
        withoutRefused(loaded, loadedContext.value.refusedPlugins),
      );
      const unavailable = unavailableTypes(destination.types, exporters);
      if (unavailable !== undefined) throw new ToolRefusal(unavailable);
      const summary = {
        folder: shown(destination.directory),
        formats: destination.formats ?? null,
        types: destination.types,
      };
      if (request.dryRun === true) {
        return {
          status: 'ok',
          diagnostics: [],
          exported: false,
          ...summary,
          files: [],
          cancelled: false,
        };
      }
      const { report, answer } = await run(
        { path: briefPath },
        request.template === undefined ? {} : { template: request.template },
        false,
        signal,
        loadedContext,
        { ...destination, rasterized: needsRasterizer(destination.types, exporters) },
      );
      return {
        ...answer,
        exported: report.result.artifacts.length > 0,
        ...summary,
        files: report.result.artifacts.map((artifact) => artifact.name),
        cancelled: report.result.cancelled,
      };
    },

    async runRecipe(request) {
      if (trust !== 'trusted' || workspace === undefined) {
        throw new ToolRefusal('run_recipe runs only in a trusted workspace');
      }
      if (environment.home === undefined) {
        throw new ToolRefusal('run_recipe needs a Tyto home folder (TYTO_HOME) for its state');
      }
      if (extname(request.path).toLowerCase() !== '.recipe') {
        throw new ToolRefusal('run_recipe runs a .recipe file and nothing else');
      }
      const confined = await confinedPath(request.path, cwd, roots);
      if (!confined.ok) throw new ToolRefusal(confined.reason);
      const path = confined.path;
      const runner = await sessionRecipeRunner(environment.home);
      const source: RecipeSource = { shown: shown(path), text: await readFile(path, 'utf8') };
      if (request.apply === undefined) {
        // `saved`, never `explicit`: every cell runs, sources included, and `apply auto` stays
        // a plan, since a Run is the person's approval and an agent's call is not (ADR 0170).
        const answer = await runner.run({
          documentId: path,
          text: source.text,
          path,
          saved: true,
          fresh: true,
        });
        return runAnswer(answer, source);
      }
      const { cell, plan } = request.apply;
      const after = await runner.apply({ documentId: path, index: cell, planId: plan, path });
      if (after === undefined) throw new ToolRefusal(RECIPE_RUN_FIRST);
      // A refusal (a plan replaced, applied already, a stale cell) is `E_RECIPE_APPLY` on this
      // answer, and the cell may still carry an earlier Apply's record: that is not this one.
      const refused = after.diagnostics.some((item) => item.code === 'E_RECIPE_APPLY');
      return {
        recipe: source.shown,
        applied: !refused && after.applied !== undefined && after.planId === plan,
        cell: cellAnswer(after, source),
      };
    },

    async close() {
      try {
        await rasterizer?.close?.();
      } finally {
        await loaded.close();
      }
    },
  };
}
