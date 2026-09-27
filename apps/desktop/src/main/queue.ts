import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Diagnostics } from '@tyto/core';
import {
  type BriefSource,
  type BriefTask,
  BRIEF_FILE,
  OUT_DIR,
  RESULT_FILE,
  type RenderResult,
  parseRenderResult,
  pollSource,
} from '@tyto/io';
import type { OutputRequest } from '@tyto/pipeline';

import type { ExportProgress, ExportRequest } from './export.js';

/**
 * The local queue panel's half in main (TYTO-45, `docs/integrations.md` What stays in Tyto).
 *
 * **A folder is the queue, laid out the way `tyto watch <folder>` lays it out**:
 * `<folder>/inbox/<id>/brief.brief` in, `<folder>/outbox/<id>/out/` out, and a task that
 * rendered cleanly moved to `<folder>/done/<id>/`. One shape for both programs, so a person
 * can point the window at a folder the CLI has been watching and see the same tasks.
 *
 * **Nothing here knows it is a folder except the composition root.** The inbox and the done
 * list are two `BriefSource`s (`@tyto/io`'s port), built by whoever calls this — the second
 * one because `done/<id>/brief.brief` is exactly an inbox's shape, so listing what finished is
 * the same `pull` over a different root. The render is the export service's `run`, which is
 * why a task rendered here and the same brief exported from the dialog produce the same files.
 *
 * **A failed task is never re-run on its own** (ADR 0008 keeps it in the inbox so a person can
 * fix it). With auto-run on, a sweep renders what it has not tried yet and skips what failed;
 * `run` is how a person says "try again", normally after fixing the brief in the editor.
 *
 * **One consumer per folder.** `fsInbox` has no claim step — `ack` is a rename — so the
 * window's auto-run and a `tyto watch` on the same folder would both render a task, and the
 * slower one's rename fails. That is not locked against here; it is reported, as a failure
 * on the task, and never as a crash (`docs/integrations.md`).
 */

export type QueueStatus = 'pending' | 'rendering' | 'done' | 'error';

export interface QueueTaskView {
  readonly id: string;
  readonly status: QueueStatus;
  readonly diagnostics: Diagnostics | RenderResult['diagnostics'];
  /** Something that is not a diagnostic: a render that died, or an acknowledgement that failed. */
  readonly failure?: string;
  /** Whether `out/` has a `result.json`, which is what makes "open output folder" worth offering. */
  readonly hasOutput: boolean;
}

export interface QueueView {
  /** The queue folder, or `null` while none has been chosen. */
  readonly folder: string | null;
  /** Where task folders are dropped, so the panel can say so. `null` with no folder. */
  readonly inbox: string | null;
  readonly autoRun: boolean;
  readonly tasks: readonly QueueTaskView[];
}

/** The two sources a folder is read through, built by the composition root. */
export interface QueueSources {
  readonly inbox: BriefSource;
  readonly done: BriefSource;
}

export interface QueueOptions {
  /** `fsInbox` twice in the app, fakes in a test. */
  readonly sources: (folder: string) => QueueSources;
  /** The export service's `run`. */
  readonly render: (request: ExportRequest) => Promise<ExportProgress>;
  readonly folder: string | null;
  readonly autoRun: boolean;
  /** Something the panel shows changed. The composition root pushes `queue:changed`. */
  readonly onChange: () => void;
  /** Between sweeps. Defaults to `pollSource`'s one second. */
  readonly intervalMs?: number;
  /**
   * A task's brief moved from `inbox/` to `done/`. The composition root points any tab that
   * holds it at the new path, so a brief fixed in the editor can still be saved afterwards.
   */
  readonly onMoved?: (from: string, to: string) => void;
  /** A failure that is not the task's, written to the app's log. */
  readonly onError?: (message: string, cause: unknown) => void;
  /** Reads `result.json`; replaceable so a test need not write one. */
  readonly readResult?: (directory: string) => Promise<RenderResult | undefined>;
}

export interface QueueService {
  view(): Promise<QueueView>;
  setFolder(folder: string | null): Promise<void>;
  setAutoRun(on: boolean): void;
  /** Renders the task now, whatever auto-run says. Resolves when the render is over. */
  run(id: string): Promise<void>;
  /** Where the task's brief is, if the queue has listed it. Only a listed task is openable. */
  briefPath(id: string): string | undefined;
  /** `outbox/<id>/out`, if the queue has listed the task. */
  outDirectory(id: string): string | undefined;
  close(): void;
}

/** What a sweep of the queue produced in PNG, which is `tyto watch`'s default. */
const QUEUE_OUTPUTS: readonly OutputRequest[] = [{ kind: 'png' }];

async function readResultFile(directory: string): Promise<RenderResult | undefined> {
  try {
    const parsed = parseRenderResult(
      JSON.parse(await readFile(join(directory, RESULT_FILE), 'utf8')),
    );
    return parsed.ok ? parsed.value : undefined;
  } catch {
    // No file yet, or one somebody cut short. Either way there is no verdict to show.
    return undefined;
  }
}

/** What this session knows about a task, beyond what the disk says. */
interface Known {
  readonly status: 'rendering' | 'done' | 'error';
  readonly diagnostics: QueueTaskView['diagnostics'];
  readonly failure?: string;
}

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export function createQueueService(options: QueueOptions): QueueService {
  const readResult = options.readResult ?? readResultFile;

  let folder = options.folder === null ? null : resolve(options.folder);
  let autoRun = options.autoRun;
  let sources = folder === null ? undefined : options.sources(folder);
  let controller: AbortController | undefined;
  // Replaced, not cleared, when the folder changes: pointing the window somewhere else must
  // not carry one folder's `task-1` failure onto another's, and a render still finishing in
  // the old folder writes into the old map.
  let known = new Map<string, Known>();
  let listed = new Map<string, string>();
  let lastInbox = '';
  // One render at a time, whoever asked. A sweep and a click on Run must not render the
  // same task twice, and a render saturates a machine on its own.
  let chain: Promise<void> = Promise.resolve();

  const outOf = (root: string, id: string): string => join(root, 'outbox', id, OUT_DIR);

  function serial(work: () => Promise<void>): Promise<void> {
    const next = chain.then(work, work);
    // The chain must never hold a rejection, or every later render would inherit it.
    chain = next.catch(() => undefined);
    return next;
  }

  async function render(root: string, inbox: BriefSource, task: BriefTask): Promise<void> {
    const record = known;
    record.set(task.id, { status: 'rendering', diagnostics: [] });
    options.onChange();

    const progress = await options.render({
      brief: task.brief,
      directory: outOf(root, task.id),
      assetBase: task.assetBase,
      label: task.id,
      outputs: QUEUE_OUTPUTS,
    });
    const diagnostics = progress.diagnostics;

    if (progress.failure !== undefined || progress.result?.status !== 'ok') {
      record.set(task.id, {
        status: 'error',
        diagnostics,
        ...(progress.failure === undefined ? {} : { failure: progress.failure }),
      });
      options.onChange();
      return;
    }

    try {
      // Only now, and never after an error (ADR 0008).
      await inbox.ack(task.id);
      // The layout `tyto watch` uses, and the one the composition root's `done` source reads.
      options.onMoved?.(task.briefPath, join(root, 'done', task.id, BRIEF_FILE));
      record.set(task.id, { status: 'done', diagnostics });
    } catch (cause) {
      // Measured for TYTO-45: this is where a second consumer on the same folder lands — it
      // moved the task first and the rename finds nothing — and where Windows lands when the
      // folder is open in Explorer. The render is on disk; the task is not where it should be,
      // and a person has to know that, so it is the task's failure and not an exception.
      options.onError?.('queue: acknowledging a task failed', cause);
      record.set(task.id, {
        status: 'error',
        diagnostics,
        failure: `rendered, but could not be moved to done/: ${message(cause)}`,
      });
    }
    options.onChange();
  }

  function start(): void {
    controller?.abort();
    controller = undefined;
    if (folder === null || sources === undefined) return;

    const root = folder;
    const { inbox } = sources;
    const own = new AbortController();
    controller = own;

    // A source that says when its listing changed, so a folder dropped in with auto-run off
    // still appears in the panel: the sweep is what notices it, whether or not it renders.
    const watched: BriefSource = {
      async pull() {
        const tasks = await inbox.pull();
        const signature = tasks.map((task) => task.id).join('\n');
        if (signature !== lastInbox) {
          lastInbox = signature;
          options.onChange();
        }
        return tasks;
      },
      ack: (id) => inbox.ack(id),
    };

    void pollSource(
      watched,
      async (task) => {
        if (!autoRun || own.signal.aborted) return;
        // Tried already this session, whatever came of it: a failure waits for a person.
        if (known.has(task.id)) return;
        // Failed in an earlier session: `result.json` says so, and the same rule holds.
        if ((await readResult(outOf(root, task.id)))?.status === 'error') return;
        await serial(() => render(root, inbox, task));
      },
      {
        signal: own.signal,
        ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
        onError: (task, cause) => {
          options.onError?.(`queue: task ${task.id} failed outside the render`, cause);
          known.set(task.id, { status: 'error', diagnostics: [], failure: message(cause) });
          options.onChange();
        },
      },
    ).catch((cause: unknown) => {
      // `pollSource` catches per task and per listing, so this is a bug rather than a folder.
      options.onError?.('queue: the watcher stopped', cause);
    });
  }

  start();

  return {
    async view(): Promise<QueueView> {
      if (folder === null || sources === undefined) {
        return { folder: null, inbox: null, autoRun, tasks: [] };
      }
      const root = folder;
      const [waiting, finished] = await Promise.all([
        sources.inbox.pull().catch(() => [] as readonly BriefTask[]),
        sources.done.pull().catch(() => [] as readonly BriefTask[]),
      ]);

      listed = new Map([...finished, ...waiting].map((task) => [task.id, task.briefPath]));

      const describe = async (
        task: BriefTask,
        onDisk: 'waiting' | 'done',
      ): Promise<QueueTaskView> => {
        const result = await readResult(outOf(root, task.id));
        const hasOutput = result !== undefined;
        const memory = known.get(task.id);
        // What this session saw wins over the disk, except that a task this session
        // rendered and something else then moved is still the one on disk.
        if (memory !== undefined && !(memory.status === 'done' && onDisk === 'waiting')) {
          return {
            id: task.id,
            status: memory.status,
            diagnostics: memory.diagnostics,
            ...(memory.failure === undefined ? {} : { failure: memory.failure }),
            hasOutput,
          };
        }
        if (onDisk === 'done') {
          return { id: task.id, status: 'done', diagnostics: result?.diagnostics ?? [], hasOutput };
        }
        return result?.status === 'error'
          ? { id: task.id, status: 'error', diagnostics: result.diagnostics, hasOutput }
          : { id: task.id, status: 'pending', diagnostics: [], hasOutput };
      };

      const tasks = await Promise.all([
        ...waiting.map((task) => describe(task, 'waiting')),
        ...finished.map((task) => describe(task, 'done')),
      ]);
      return { folder: root, inbox: join(root, 'inbox'), autoRun, tasks };
    },

    async setFolder(next: string | null): Promise<void> {
      folder = next === null ? null : resolve(next);
      sources = folder === null ? undefined : options.sources(folder);
      known = new Map();
      listed = new Map();
      lastInbox = '';
      if (folder !== null) {
        // Made, so a person who picked an empty folder can see where to drop a task. Failing
        // is harmless: the sweep treats a missing inbox as an empty one.
        await mkdir(join(folder, 'inbox'), { recursive: true }).catch(() => undefined);
      }
      start();
      options.onChange();
    },

    setAutoRun(on: boolean): void {
      autoRun = on;
      options.onChange();
    },

    run(id: string): Promise<void> {
      if (folder === null || sources === undefined) return Promise.resolve();
      if (known.get(id)?.status === 'rendering') return Promise.resolve();
      const root = folder;
      const { inbox } = sources;
      return serial(async () => {
        // Read again rather than reused: the point of running a failed task is usually that
        // somebody just saved a fixed brief.
        const task = (await inbox.pull()).find((candidate) => candidate.id === id);
        if (task === undefined) return;
        await render(root, inbox, task);
      });
    },

    briefPath: (id) => listed.get(id),

    outDirectory: (id) => (folder !== null && listed.has(id) ? outOf(folder, id) : undefined),

    close(): void {
      controller?.abort();
      controller = undefined;
    },
  };
}
