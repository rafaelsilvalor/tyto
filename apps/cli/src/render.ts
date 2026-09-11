import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { Diagnostics } from '@tyto/core';
import { ASSETS_DIR } from '@tyto/io';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { type OutputKind, needsRasterizer, outputRequests } from './options.js';
import { loadRenderContext, readFailure } from './render-context.js';
import { renderTask } from './render-task.js';
import { diagnosticsDocument, formatDiagnostics, json } from './report.js';

/**
 * `tyto render <brief> --out <dir>` — the contract command (ADR 0011).
 *
 * It writes the artifacts and a `result.json` into `--out` and nothing anywhere else, so
 * the folder it produces is the same folder `tyto watch` produces for the same task. That
 * is what lets the watcher double as a Jacurutu simulator.
 */

export interface RenderCommandOptions {
  readonly out: string;
  readonly template?: string;
  readonly formats?: readonly string[];
  readonly types: readonly OutputKind[];
  readonly scale?: number;
  readonly quality?: number;
  readonly templates: string;
  readonly formatsFile: string;
  readonly assets?: string;
  readonly concurrency?: number;
  readonly json: boolean;
}

/** Paths are printed as the user would type them, not as this machine stores them. */
export function displayPath(cwd: string, path: string): string {
  const shown = relative(cwd, path);
  return shown === '' || shown.startsWith('..') ? path : shown;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * `assets/` beside the brief when there is one, the brief's own folder otherwise.
 *
 * Exactly `fsInbox`'s rule, because a task rendered by hand and the same task rendered by
 * the watcher have to resolve `./logo.png` to the same file. `--assets` overrides it for
 * an author whose own layout is neither.
 */
export async function assetBaseFor(briefDirectory: string, override?: string): Promise<string> {
  if (override !== undefined) return override;
  const beside = join(briefDirectory, ASSETS_DIR);
  return (await isDirectory(beside)) ? beside : briefDirectory;
}

/** Prints a run that never got as far as a job: no artifacts, no `result.json`. */
function reportFailure(
  diagnostics: Diagnostics,
  options: RenderCommandOptions,
  environment: CliEnvironment,
  primary?: { readonly path: string; readonly source: string },
): ExitCode {
  const scope = primary === undefined ? {} : { primary };
  if (options.json) {
    environment.console.out(json(diagnosticsDocument(diagnostics, scope)));
  } else {
    environment.console.err(formatDiagnostics(diagnostics, scope));
  }
  return EXIT_DIAGNOSTICS;
}

export async function renderCommand(
  brief: string,
  options: RenderCommandOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const { cwd } = environment;
  const briefPath = isAbsolute(brief) ? brief : resolve(cwd, brief);
  const shownBrief = displayPath(cwd, briefPath);

  let source: string;
  try {
    source = await readFile(briefPath, 'utf8');
  } catch (cause) {
    return reportFailure(readFailure(shownBrief, cause), options, environment);
  }

  const context = await loadRenderContext({
    templatesDirectory: resolve(cwd, options.templates),
    formatsFile: resolve(cwd, options.formatsFile),
  });
  if (!context.ok) {
    return reportFailure(context.error, options, environment, {
      path: shownBrief,
      source,
    });
  }

  const rasterizer = needsRasterizer(options.types) ? environment.rasterizer() : undefined;

  try {
    const report = await renderTask(
      context.value,
      {
        id: shownBrief,
        brief: source,
        briefPath: shownBrief,
        assetBase: await assetBaseFor(resolve(briefPath, '..'), options.assets),
        outDirectory: resolve(cwd, options.out),
      },
      {
        outputs: outputRequests(options),
        version: environment.version,
        ...(options.template === undefined ? {} : { template: options.template }),
        ...(options.formats === undefined ? {} : { formats: options.formats }),
        ...(rasterizer === undefined ? {} : { rasterizer }),
        ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      },
      context.warnings,
    );

    const scope = { primary: { path: shownBrief, source } };

    if (options.json) {
      environment.console.out(
        json({
          status: report.result.status,
          cancelled: report.result.cancelled,
          planned: report.result.planned,
          artifacts: report.result.artifacts,
          // Located, unlike the `result.json` on disk: that document is the ADR 0011
          // contract and carries offsets, and adding a line number to it would be a
          // change to a schema the other side validates.
          diagnostics: diagnosticsDocument(report.diagnostics, scope).diagnostics,
        }),
      );
    } else {
      if (report.diagnostics.length > 0) {
        environment.console.err(formatDiagnostics(report.diagnostics, scope));
      }
      // Names on stdout, one per line, so a shell can pipe them somewhere.
      for (const artifact of report.result.artifacts) environment.console.out(`${artifact.name}\n`);
    }

    return report.ok ? EXIT_OK : EXIT_DIAGNOSTICS;
  } finally {
    await rasterizer?.close?.();
  }
}
