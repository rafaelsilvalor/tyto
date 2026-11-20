import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve as resolvePath } from 'node:path';

import { parseBrief } from '@tyto/brief-lang';
import { type Diagnostics, diagnostic, hasErrors, lineColumnAt, resolve } from '@tyto/core';
import { EDITABLE_DIR, briefAssetResolver } from '@tyto/io';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { GUIDE_KIND, INLINE_CANVAS_PREFIX, declaresExternalArt, noExternalArt } from './guide.js';
import {
  type GuideCandidates,
  type GuideTarget,
  guideCandidates,
  guideOverwrite,
  guidePaths,
} from './guide-candidates.js';
import { withoutRefused } from './plugins/index.js';
import { type RenderContext, readFailure } from './render-context.js';
import {
  type RenderTask,
  type RenderTaskOptions,
  memoryTaskOutput,
  renderTask,
} from './render-task.js';
import { displayPath } from './render.js';
import { formatDiagnostics } from './report.js';
import { googleFontsOption } from './google-fonts.js';
import { optionalSources, renderSources } from './sources.js';
import { templatesInReach } from './templates-in-reach.js';
import { workspaceOfBrief } from './workspace.js';

/**
 * `tyto guide <brief>` (TYTO-741, ADR 0222): the PSD each external-art file the brief cites is
 * painted in, written beside that file and named after it, so the PNG painted from it lands
 * where the brief reads it back. `tyto render --guide` stays the render's (ADR 0221).
 */

export interface GuideCommandOptions {
  /** `--all`: every guide, the ones already there included. */
  readonly all?: boolean;
  /** `--only <file...>`: the guides of these cited files (as the brief writes them) or guide names. */
  readonly only?: readonly string[];
  /** `--list`: print the candidates and write nothing. */
  readonly list?: boolean;
  /** `--force`: write over a guide newer than the brief. */
  readonly force?: boolean;
  /** `--open`: open each guide written in the program this machine opens a PSD with. */
  readonly open?: boolean;
  readonly trust?: boolean;
  readonly template?: string;
  readonly formats?: readonly string[];
  readonly templates: string;
  readonly templatesNamed?: boolean;
  readonly formatsFile: string;
  readonly formatsNamed?: boolean;
  readonly googleFonts?: boolean;
}

/** A guide target and what is on disk for it. */
export interface GuideState extends GuideTarget {
  /** Milliseconds; absent when the guide is not there. */
  readonly guideModified?: number;
  readonly artExists: boolean;
}

export interface WriteGuidesRequest {
  readonly context: RenderContext;
  /** The brief to render; where its artifacts would go is not read, the guides go to the targets. */
  readonly task: Omit<
    RenderTask,
    'outDirectory' | 'output' | 'folder' | 'delivery' | 'removeLeftovers'
  >;
  readonly options: Omit<RenderTaskOptions, 'outputs' | 'guide'>;
  readonly targets: readonly GuideTarget[];
  readonly inherited?: Diagnostics;
}

export interface WrittenGuides {
  readonly written: readonly GuideTarget[];
  readonly diagnostics: Diagnostics;
  readonly ok: boolean;
}

/**
 * Renders the brief's guide once (`render --guide`'s path, into memory) and writes each
 * target's PSD to its own path. The piece's frames come from the first artwork, the one a
 * repeating brief's art is painted to (ADR 0222, decision 6); an inline canvas from its slot's.
 */
export async function writeGuides(request: WriteGuidesRequest): Promise<WrittenGuides> {
  const report = await renderTask(
    request.context,
    { ...request.task, outDirectory: request.task.briefDirectory, output: memoryTaskOutput() },
    { ...request.options, outputs: [{ kind: GUIDE_KIND }], guide: true },
    request.inherited,
  );
  const frame = report.artifacts.find(
    (artifact) => !artifact.artwork.startsWith(INLINE_CANVAS_PREFIX),
  )?.artwork;
  const written: GuideTarget[] = [];
  for (const target of request.targets) {
    const artwork = target.kind === 'inline' ? `${INLINE_CANVAS_PREFIX}${target.slot}` : frame;
    const artifact = report.artifacts.find(
      (made) => made.artwork === artwork && made.format === target.format,
    );
    if (artifact === undefined) continue;
    await mkdir(dirname(target.guide), { recursive: true });
    await writeFile(target.guide, artifact.bytes);
    written.push(target);
  }
  return {
    written,
    diagnostics: report.diagnostics,
    ok: report.ok && written.length === request.targets.length,
  };
}

function modifiedAt(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** One target per guide file: a file the brief cites twice, or a repeating brief's, is one guide. */
function targetsOf(
  found: GuideCandidates,
  formats: readonly string[],
  briefDirectory: string,
): GuideState[] {
  const location = {
    briefDirectory,
    delivery: basename(briefDirectory) === EDITABLE_DIR,
    exists: (path: string) => existsSync(path),
  };
  const seen = new Set<string>();
  const states: GuideState[] = [];
  for (const candidate of found.candidates) {
    for (const target of guidePaths(candidate, formats, location)) {
      if (seen.has(target.guide)) continue;
      seen.add(target.guide);
      const guideModified = modifiedAt(target.guide);
      states.push({
        ...target,
        ...(guideModified === undefined ? {} : { guideModified }),
        artExists: existsSync(target.art),
      });
    }
  }
  return states;
}

function guideState(state: GuideState, briefModified: number): string {
  if (state.guideModified === undefined) return 'missing';
  return state.guideModified > briefModified ? 'newer than the brief' : 'older than the brief';
}

/** `--list`: each cited file, its guides with their state, then what the brief cites no file for. */
function listing(
  found: GuideCandidates,
  states: readonly GuideState[],
  source: string,
  briefModified: number,
  shown: (path: string) => string,
): string {
  const lines: string[] = [];
  for (const candidate of found.candidates) {
    const line = lineColumnAt(source, candidate.range.start).line;
    const own = states.filter(
      (state) => state.slot === candidate.slot && state.cited === candidate.cited,
    );
    if (own.length === 0) continue;
    lines.push(`${candidate.slot} (${candidate.kind}): ${candidate.cited}, line ${line}`);
    for (const state of own) {
      lines.push(
        `  ${state.format}: guide ${shown(state.guide)} ${guideState(state, briefModified)}; ` +
          `art ${shown(state.art)} ${state.artExists ? 'present' : 'missing'}`,
      );
    }
  }
  for (const entry of found.unguided) {
    const line = lineColumnAt(source, entry.range.start).line;
    lines.push(`${entry.slot}: ${entry.cited}, line ${line}: no guide, ${entry.reason}`);
  }
  for (const entry of found.uncited) {
    lines.push(
      `${entry.slot} (${entry.kind}): not cited; add ${JSON.stringify(entry.line)} to the brief`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function matches(state: GuideState, wanted: string): boolean {
  return state.cited === wanted || basename(state.guide) === wanted;
}

export async function guideCommand(
  brief: string,
  options: GuideCommandOptions,
  environment: CliEnvironment,
  signal?: AbortSignal,
): Promise<ExitCode> {
  const { cwd } = environment;
  const shown = (path: string): string => displayPath(cwd, path);
  const briefPath = isAbsolute(brief) ? brief : resolvePath(cwd, brief);
  const shownBrief = shown(briefPath);
  const briefDirectory = dirname(briefPath);
  const fail = (diagnostics: Diagnostics, source?: string): ExitCode => {
    environment.console.err(
      formatDiagnostics(
        diagnostics,
        source === undefined ? {} : { primary: { path: shownBrief, source } },
      ),
    );
    return EXIT_DIAGNOSTICS;
  };

  let source: string;
  let briefModified: number;
  try {
    source = await readFile(briefPath, 'utf8');
    briefModified = (await stat(briefPath)).mtimeMs;
  } catch (cause) {
    return fail(readFailure(shownBrief, cause));
  }
  if (options.open === true && environment.openFile === undefined) {
    environment.console.err('error: --open is not available here: nothing can open a file\n');
    return EXIT_DIAGNOSTICS;
  }

  const parsed = parseBrief(source);
  if (!parsed.ok) return fail(parsed.error, source);

  const workspace = await workspaceOfBrief(briefPath, options, environment, shown);
  const project = workspace?.loaded.project;
  const reach = await templatesInReach(
    {
      workspace,
      hostName: 'tyto guide',
      folder: cwd,
      templates: {
        directory: resolvePath(cwd, options.templates),
        named: options.templatesNamed === true,
      },
      formats: {
        file: resolvePath(cwd, options.formatsFile),
        named: options.formatsNamed === true,
      },
    },
    environment,
  );
  if (reach.leftOut !== '') environment.console.err(reach.leftOut);
  const plugins = withoutRefused(
    reach.plugins,
    reach.context.ok ? reach.context.value.refusedPlugins : new Set(),
  );
  try {
    const inherited = [
      ...(workspace?.diagnostics ?? []),
      ...reach.pluginFiles.diagnostics,
      ...(reach.context.ok ? reach.context.diagnostics : []),
    ];
    if (!reach.context.ok) return fail([...inherited, ...reach.context.error], source);
    const context = reach.context.value;

    // `resolve` answers the template and the formats by the brief's own rules (an alias, a
    // configuration's formats, `--formats` narrowing the brief's). A plugin directive is left
    // out: its slots are not cited in the brief's text, and expanding it would start the plugin.
    const assets = briefAssetResolver({
      briefDirectory,
      ...(project === undefined ? {} : { projectAssets: project.assets }),
    });
    const resolved = await resolve(
      {
        ...parsed.value,
        directives: parsed.value.directives.filter((entry) => entry.namespace === undefined),
      },
      {
        registry: context.registry,
        configurations: context.configurations,
        assets,
        ...(options.template === undefined ? {} : { template: options.template }),
        ...(options.formats === undefined ? {} : { formats: options.formats }),
      },
    );
    if (!resolved.ok) return fail([...inherited, ...resolved.error], source);
    const manifest = context.registry.get(resolved.value.template);
    if (manifest === undefined || !declaresExternalArt(manifest)) {
      return fail(
        manifest === undefined ? inherited : [...inherited, noExternalArt(manifest)],
        source,
      );
    }

    const found = guideCandidates(parsed.value, manifest);
    const states = targetsOf(found, resolved.value.formats, briefDirectory);
    if (options.list === true) {
      environment.console.out(listing(found, states, source, briefModified, shown));
      return EXIT_OK;
    }

    const only = options.only ?? [];
    const unknown = only.filter((wanted) => !states.some((state) => matches(state, wanted)));
    if (unknown.length > 0) {
      environment.console.err(
        `error: the brief cites no external art named ${unknown.map((name) => `'${name}'`).join(', ')}; tyto guide --list shows what it cites\n`,
      );
      return EXIT_DIAGNOSTICS;
    }
    const chosen = states.filter((state) =>
      only.length > 0
        ? only.some((wanted) => matches(state, wanted))
        : options.all === true || state.guideModified === undefined,
    );
    if (chosen.length === 0) {
      environment.console.err(
        states.length === 0
          ? `${shownBrief}: the brief cites no file for its external art; tyto guide --list says what to add\n`
          : `${shownBrief}: every guide is already there; --all writes them again\n`,
      );
      return EXIT_OK;
    }

    // All or nothing: a run that wrote half its guides and refused the rest would leave a
    // folder nobody can tell apart from a finished one.
    const refused = chosen
      .filter(
        (state) =>
          guideOverwrite({
            ...(state.guideModified === undefined ? {} : { guideModified: state.guideModified }),
            briefModified,
            force: options.force === true,
            interactive: false,
          }) !== 'write',
      )
      .map((state) => diagnostic('E_GUIDE_NEWER_THAN_BRIEF', { guide: shown(state.guide) }));
    if (refused.length > 0) return fail([...inherited, ...refused], source);

    const rasterizer = environment.rasterizer();
    try {
      const result = await writeGuides({
        context,
        task: {
          id: shownBrief,
          brief: source,
          briefPath: shownBrief,
          briefDirectory,
          ...(project === undefined ? {} : { projectAssets: project.assets }),
        },
        options: {
          version: environment.version,
          plugins,
          rasterizer,
          formats: resolved.value.formats,
          ...(options.template === undefined ? {} : { template: options.template }),
          ...(signal === undefined ? {} : { signal }),
          ...(project === undefined ? {} : { fontDirectories: project.fonts }),
          ...optionalSources(renderSources(environment.home, workspace?.loaded)),
          ...googleFontsOption(options.googleFonts, environment.variables),
        },
        targets: chosen,
        inherited,
      });
      // The art is missing by design here: the guide is what it is about to be painted in.
      const said = result.diagnostics.filter((item) => item.code !== 'W_EXTERNAL_ART_MISSING');
      if (said.length > 0) {
        environment.console.err(formatDiagnostics(said, { primary: { path: shownBrief, source } }));
      }
      for (const target of result.written) environment.console.out(`${shown(target.guide)}\n`);
      if (options.open === true) {
        for (const target of result.written) await environment.openFile?.(target.guide);
      }
      return result.ok && !hasErrors(result.diagnostics) ? EXIT_OK : EXIT_DIAGNOSTICS;
    } finally {
      await rasterizer.close?.();
    }
  } finally {
    await plugins.close();
  }
}
