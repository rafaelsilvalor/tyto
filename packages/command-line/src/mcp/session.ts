import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { Diagnostics, Trust } from '@tyto/core';

import type { CliEnvironment, CliRasterizer } from '../environment.js';
import { templateSkeleton } from '../delivery.js';
import { googleFontsOption } from '../google-fonts.js';
import {
  NO_PLUGIN_FILES,
  type SyncedPluginFiles,
  leftOutPluginFiles,
  syncPluginFiles,
} from '../plugin-files.js';
import {
  type LoadedPlugins,
  loadInstalledPlugins,
  pluginCapabilities,
  withoutRefused,
} from '../plugins/index.js';
import { type RenderContext, loadRenderContext } from '../render-context.js';
import {
  type RenderTaskReport,
  type TaskSources,
  memoryTaskOutput,
  renderTask,
} from '../render-task.js';
import { displayPath, installedOption } from '../render.js';
import { type LocatedDiagnostic, diagnosticsDocument, registerUnplaced } from '../report.js';
import { optionalSources, renderSources } from '../sources.js';
import { type BriefWorkspace, workspaceOfFolder } from '../workspace.js';
import { confinedPath } from './confine.js';
import { PREVIEW_MAX_IMAGES, PREVIEW_MAX_SIDE, ToolRefusal } from './tools.js';

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
  close(): Promise<void>;
}

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

interface LoadedContext {
  readonly value: RenderContext;
  readonly diagnostics: Diagnostics;
}

/** What the server reports for a brief handed over as text. */
const INLINE_BRIEF = '<inline brief>';

export async function openSession(environment: CliEnvironment): Promise<McpSession> {
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
  ): Promise<{ readonly report: RenderTaskReport; readonly answer: CheckAnswer }> {
    const brief = await briefOf(input);
    const { value, diagnostics } = loadedContext ?? (await context());
    const plugins = withoutRefused(loaded, value.refusedPlugins);
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
        outDirectory: cwd,
        output: memoryTaskOutput(),
        assetRoots: [...roots, ...(project?.assets ?? [])],
      },
      {
        // A check exports SVG, which needs no browser; a preview a PNG (ADR 0179 decision 4).
        outputs: [
          preview
            ? { kind: 'png', ...(options.scale === undefined ? {} : { scale: options.scale }) }
            : { kind: 'svg' },
        ],
        version: environment.version,
        plugins,
        ...(options.template === undefined ? {} : { template: options.template }),
        ...(options.format === undefined ? {} : { formats: [options.format] }),
        ...(preview ? { rasterizer: sessionRasterizer(), concurrency: 1 } : {}),
        ...(signal === undefined ? {} : { signal }),
        ...(project === undefined ? {} : { fontDirectories: project.fonts }),
        ...optionalSources(sources === undefined ? undefined : sourcesFor(sources, preview)),
        ...(preview ? googleFontsOption(true, environment.variables) : {}),
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

    async close() {
      try {
        await rasterizer?.close?.();
      } finally {
        await loaded.close();
      }
    },
  };
}
