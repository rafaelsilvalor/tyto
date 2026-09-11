import { join, resolve } from 'node:path';

import { type BriefTask, OUT_DIR, fsInbox, pollSource } from '@tyto/io';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { type OutputKind, needsRasterizer, outputRequests } from './options.js';
import { loadRenderContext } from './render-context.js';
import { renderTask } from './render-task.js';
import { displayPath } from './render.js';
import { diagnosticsDocument, formatDiagnostics, json } from './report.js';

/**
 * `tyto watch <folder>` — the fs-inbox adapter, driven (ADR 0008, `docs/integrations.md`).
 *
 * `<folder>/inbox/<id>/brief.brief` in, `<folder>/outbox/<id>/out/…` out, and a folder
 * that succeeded is moved to `<folder>/done/`. A folder that failed **stays where it is**,
 * because acknowledging a failure quietly loses work and tells nobody — which is the one
 * rule ADR 0008 is emphatic about.
 *
 * The loop is `pollSource`'s, for the reasons recorded there: `fs.watch` reports a folder
 * while it is still being copied into, and a poll is the only thing that works on the
 * network share a shared inbox ends up on.
 */

export interface WatchCommandOptions {
  readonly types: readonly OutputKind[];
  readonly scale?: number;
  readonly quality?: number;
  readonly template?: string;
  readonly formats?: readonly string[];
  readonly templates: string;
  readonly formatsFile: string;
  readonly interval?: number;
  readonly concurrency?: number;
  /** Handle whatever is in the inbox right now and return, instead of watching. */
  readonly once: boolean;
  readonly json: boolean;
}

export async function watchCommand(
  folder: string,
  options: WatchCommandOptions,
  environment: CliEnvironment,
  signal?: AbortSignal,
): Promise<ExitCode> {
  const { cwd } = environment;
  const root = resolve(cwd, folder);

  const context = await loadRenderContext({
    templatesDirectory: resolve(cwd, options.templates),
    formatsFile: resolve(cwd, options.formatsFile),
  });
  if (!context.ok) {
    if (options.json) {
      environment.console.out(json(diagnosticsDocument(context.error)));
    } else {
      environment.console.err(formatDiagnostics(context.error));
    }
    return EXIT_DIAGNOSTICS;
  }

  // Destructured past the guard above, so the closure below reads a `RenderContext` and
  // not a `Result` it would have to re-narrow on every task.
  const { value: project, warnings: projectProblems } = context;

  const inbox = fsInbox({ root: join(root, 'inbox'), done: join(root, 'done') });
  const rasterizer = needsRasterizer(options.types) ? environment.rasterizer() : undefined;

  // The watcher's own exit code is about the run, not about any one task: a queue that
  // handled ten tasks and failed on one has still done its job, and a person reading the
  // log wants to know a task failed. So a failure marks the run and the loop carries on.
  let failed = false;

  async function handle(task: BriefTask): Promise<void> {
    const briefPath = displayPath(cwd, task.briefPath);
    const report = await renderTask(
      project,
      {
        id: task.id,
        brief: task.brief,
        briefPath,
        assetBase: task.assetBase,
        outDirectory: join(root, 'outbox', task.id, OUT_DIR),
      },
      {
        outputs: outputRequests(options),
        version: environment.version,
        ...(options.template === undefined ? {} : { template: options.template }),
        ...(options.formats === undefined ? {} : { formats: options.formats }),
        ...(rasterizer === undefined ? {} : { rasterizer }),
        ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
        ...(signal === undefined ? {} : { signal }),
      },
      projectProblems,
    );

    const scope = { primary: { path: briefPath, source: task.brief } };

    if (options.json) {
      environment.console.out(
        json({
          task: task.id,
          status: report.result.status,
          artifacts: report.result.artifacts,
          diagnostics: diagnosticsDocument(report.diagnostics, scope).diagnostics,
        }),
      );
    } else {
      environment.console.err(
        `${task.id}: ${report.result.status} — ${String(report.result.artifacts.length)} of ` +
          `${String(report.result.planned)} artifact(s)\n`,
      );
      if (report.diagnostics.length > 0) {
        environment.console.err(formatDiagnostics(report.diagnostics, scope));
      }
    }

    if (report.ok) {
      // Only now, and never after an error (ADR 0008).
      await inbox.ack(task.id);
    } else {
      failed = true;
    }
  }

  try {
    if (options.once) {
      for (const task of await inbox.pull()) await handle(task);
    } else {
      await pollSource(inbox, handle, {
        ...(options.interval === undefined ? {} : { intervalMs: options.interval }),
        ...(signal === undefined ? {} : { signal }),
        onError: (task, cause) => {
          // A task that threw rather than producing diagnostics — an unwritable outbox,
          // say. The loop must not end on it: one broken folder would stop a queue that
          // has nine good ones behind it.
          failed = true;
          environment.console.err(
            `${task.id}: internal failure — ${cause instanceof Error ? cause.message : String(cause)}\n`,
          );
        },
      });
    }
  } finally {
    await rasterizer?.close?.();
  }

  return failed ? EXIT_DIAGNOSTICS : EXIT_OK;
}
