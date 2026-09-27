import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Diagnostic } from '@tyto/core';
import { RESULT_FILE, fsInbox, renderResult } from '@tyto/io';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportProgress, ExportRequest } from './export.js';
import { type QueueService, type QueueView, createQueueService } from './queue.js';

/**
 * The local queue against real folders and the real `fsInbox` (TYTO-45).
 *
 * The inbox is the adapter the app composes, because the claims here are about folders —
 * that a task moves to `done/` only after it rendered cleanly, that a failed one stays where
 * a person can fix it. A fake inbox would assert the fake. The render is the fake: it stands
 * for the export service, which has its own suite, and writes a `result.json` the way the real
 * one does so the panel's "open output folder" has something to find.
 */

let root: string;
let service: QueueService | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tyto-queue-'));
});

afterEach(() => {
  service?.close();
  service = undefined;
  rmSync(root, { recursive: true, force: true });
});

const BROKEN = 'QUEBRADO';

const brokenDiagnostic: Diagnostic = {
  severity: 'error',
  code: 'E_UNKNOWN_TEMPLATE',
  message: "template 'nenhum' is not installed",
  range: { start: 0, end: 8 },
};

/** Drops a task folder the way a person or Jacurutu would. */
function drop(id: string, brief: string): void {
  mkdirSync(join(root, 'inbox', id), { recursive: true });
  writeFileSync(join(root, 'inbox', id, 'brief.brief'), brief, 'utf8');
}

/** Stands for `ExportService.run`: an error for a brief that says so, a clean run otherwise. */
function fakeRender(before?: (request: ExportRequest) => void) {
  const calls: ExportRequest[] = [];
  const render = (request: ExportRequest): Promise<ExportProgress> => {
    calls.push(request);
    before?.(request);
    const diagnostics = request.brief.includes(BROKEN) ? [brokenDiagnostic] : [];
    const result = renderResult({
      cancelled: false,
      planned: 1,
      artifacts: [],
      diagnostics,
      version: '0.0.0-test',
      templates: [],
    });
    mkdirSync(request.directory, { recursive: true });
    writeFileSync(join(request.directory, RESULT_FILE), JSON.stringify(result), 'utf8');
    return Promise.resolve({
      status: 'finished',
      directory: request.directory,
      total: 1,
      done: 1,
      failed: diagnostics.length,
      result,
      diagnostics,
    });
  };
  return { calls, render };
}

function start(
  render: (request: ExportRequest) => Promise<ExportProgress>,
  options: { autoRun: boolean; onError?: (message: string, cause: unknown) => void },
) {
  const onChange = vi.fn();
  service = createQueueService({
    sources: (folder) => ({
      inbox: fsInbox({ root: join(folder, 'inbox'), done: join(folder, 'done') }),
      done: fsInbox({ root: join(folder, 'done') }),
    }),
    render,
    folder: root,
    autoRun: options.autoRun,
    onChange,
    intervalMs: 20,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });
  return { service, onChange };
}

/** The queue's view once `predicate` holds, or the last view it had when time ran out. */
async function until(
  queue: QueueService,
  predicate: (view: QueueView) => boolean,
  timeoutMs = 5000,
): Promise<QueueView> {
  const started = Date.now();
  for (;;) {
    const view = await queue.view();
    if (predicate(view)) return view;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out; last view: ${JSON.stringify(view.tasks)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const statusOf = (view: QueueView, id: string) => view.tasks.find((task) => task.id === id)?.status;

describe('with auto-run off', () => {
  it('lists a dropped folder as pending, says so, and renders nothing', async () => {
    const { calls, render } = fakeRender();
    const { service: queue, onChange } = start(render, { autoRun: false });

    drop('tarefa-1', '::titulo Olá');
    const view = await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

    expect(view.inbox).toBe(join(root, 'inbox'));
    // The sweep noticed it, which is what makes the panel redraw while nobody clicks.
    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
    });
    // A few sweeps later, still nothing rendered.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calls).toHaveLength(0);
  });

  it('renders a task when asked to, and moves it to done/', async () => {
    const { calls, render } = fakeRender();
    const { service: queue } = start(render, { autoRun: false });
    drop('tarefa-1', '::titulo Olá');
    await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

    await queue.run('tarefa-1');

    expect(calls.map((call) => call.directory)).toEqual([join(root, 'outbox', 'tarefa-1', 'out')]);
    expect(existsSync(join(root, 'done', 'tarefa-1', 'brief.brief'))).toBe(true);
    const view = await queue.view();
    expect(statusOf(view, 'tarefa-1')).toBe('done');
    expect(view.tasks.find((task) => task.id === 'tarefa-1')?.hasOutput).toBe(true);
  });
});

describe('with auto-run on', () => {
  it('renders a folder dropped while the app is open, and moves it to done/', async () => {
    const { calls, render } = fakeRender();
    const { service: queue } = start(render, { autoRun: true });

    drop('tarefa-1', '::titulo Olá');
    await until(queue, (current) => statusOf(current, 'tarefa-1') === 'done');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.label).toBe('tarefa-1');
    expect(existsSync(join(root, 'inbox', 'tarefa-1'))).toBe(false);
  });

  it('keeps a failed task in the inbox with its diagnostics, and does not run it again', async () => {
    const { calls, render } = fakeRender();
    const { service: queue } = start(render, { autoRun: true });

    drop('tarefa-1', `${BROKEN}\n::titulo Olá`);
    const view = await until(queue, (current) => statusOf(current, 'tarefa-1') === 'error');

    expect(view.tasks[0]?.diagnostics.map((item) => item.code)).toEqual(['E_UNKNOWN_TEMPLATE']);
    // ADR 0008: never acknowledge a failure. The folder is where a person can fix it.
    expect(existsSync(join(root, 'inbox', 'tarefa-1', 'brief.brief'))).toBe(true);
    // Several sweeps later, it has still been tried once: a failure waits for a person.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls).toHaveLength(1);
  });

  it('does not run again a task whose render died without writing anything', async () => {
    // The case only this session's memory covers: a render that threw leaves no `result.json`,
    // so the disk alone would make it look untried and the next sweep would start it again —
    // once a second, for as long as the window is open.
    const calls: ExportRequest[] = [];
    const dying = (request: ExportRequest): Promise<ExportProgress> => {
      calls.push(request);
      return Promise.resolve({
        status: 'finished',
        directory: request.directory,
        total: 0,
        done: 0,
        failed: 0,
        diagnostics: [],
        failure: 'the browser would not start',
      });
    };
    const { service: queue } = start(dying, { autoRun: true });

    drop('tarefa-1', '::titulo Olá');
    const view = await until(queue, (current) => statusOf(current, 'tarefa-1') === 'error');
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(view.tasks[0]?.failure).toBe('the browser would not start');
    expect(calls).toHaveLength(1);
  });

  it('runs a fixed brief again when asked, reading the file afresh', async () => {
    const { calls, render } = fakeRender();
    const { service: queue } = start(render, { autoRun: true });
    drop('tarefa-1', `${BROKEN}\n::titulo Olá`);
    await until(queue, (current) => statusOf(current, 'tarefa-1') === 'error');

    // What the editor does when a person fixes the brief and saves it.
    writeFileSync(queue.briefPath('tarefa-1') ?? '', '::titulo Olá', 'utf8');
    await queue.run('tarefa-1');

    expect(calls.map((call) => call.brief)).toEqual([`${BROKEN}\n::titulo Olá`, '::titulo Olá']);
    expect(statusOf(await queue.view(), 'tarefa-1')).toBe('done');
  });

  it('does not auto-run a task an earlier session saw fail', async () => {
    const { calls, render } = fakeRender();
    drop('tarefa-1', '::titulo Olá');
    // `result.json` from a previous run, which is all a new session knows about it.
    const out = join(root, 'outbox', 'tarefa-1', 'out');
    mkdirSync(out, { recursive: true });
    writeFileSync(
      join(out, RESULT_FILE),
      JSON.stringify(
        renderResult({
          cancelled: false,
          planned: 1,
          artifacts: [],
          diagnostics: [brokenDiagnostic],
          version: '0.0.0-test',
          templates: [],
        }),
      ),
      'utf8',
    );

    const { service: queue } = start(render, { autoRun: true });
    const view = await until(queue, (current) => statusOf(current, 'tarefa-1') === 'error');
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(view.tasks[0]?.diagnostics.map((item) => item.code)).toEqual(['E_UNKNOWN_TEMPLATE']);
    expect(calls).toHaveLength(0);
  });
});

describe('one consumer per folder', () => {
  it('reports a task somebody else moved first as a failure on the task, not a crash', async () => {
    // A `tyto watch` on the same folder, standing in: it finishes the task and moves it to
    // done/ while this render is still going, so this side's rename finds nothing.
    const { render } = fakeRender((request) => {
      if (request.label !== 'tarefa-1') return;
      mkdirSync(join(root, 'done'), { recursive: true });
      renameSync(join(root, 'inbox', 'tarefa-1'), join(root, 'done', 'tarefa-1'));
    });
    const errors: string[] = [];
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);

    try {
      const { service: queue } = start(render, {
        autoRun: false,
        onError: (message) => {
          errors.push(message);
        },
      });
      drop('tarefa-1', '::titulo Olá');
      await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

      await expect(queue.run('tarefa-1')).resolves.toBeUndefined();
      const view = await queue.view();
      const task = view.tasks.find((item) => item.id === 'tarefa-1');

      expect(task?.status).toBe('error');
      expect(task?.failure).toMatch(/^rendered, but could not be moved to done\//u);
      expect(errors).toEqual(['queue: acknowledging a task failed']);
      // Another task behind it still renders: the queue did not stop on the failed ack.
      drop('tarefa-2', '::titulo Outra');
      await until(queue, (current) => statusOf(current, 'tarefa-2') === 'pending');
      await queue.run('tarefa-2');
      expect(statusOf(await queue.view(), 'tarefa-2')).toBe('done');
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});

describe('the folder', () => {
  it('lists nothing and runs nothing before one is chosen', async () => {
    const { calls, render } = fakeRender();
    service = createQueueService({
      sources: (folder) => ({
        inbox: fsInbox({ root: join(folder, 'inbox') }),
        done: fsInbox({ root: join(folder, 'done') }),
      }),
      render,
      folder: null,
      autoRun: true,
      onChange: () => undefined,
    });

    expect(await service.view()).toEqual({ folder: null, inbox: null, autoRun: true, tasks: [] });
    await service.run('tarefa-1');
    expect(calls).toHaveLength(0);
  });

  it('makes the inbox when one is chosen, so a person can see where to drop a task', async () => {
    const { render } = fakeRender();
    const { service: queue, onChange } = start(render, { autoRun: false });
    const other = join(root, 'outra-fila');
    mkdirSync(other);

    await queue.setFolder(other);

    expect(existsSync(join(other, 'inbox'))).toBe(true);
    expect((await queue.view()).folder).toBe(other);
    expect(onChange).toHaveBeenCalled();
  });

  it('opens only what it listed', async () => {
    const { render } = fakeRender();
    const { service: queue } = start(render, { autoRun: false });
    drop('tarefa-1', '::titulo Olá');

    expect(queue.briefPath('tarefa-1')).toBeUndefined();
    await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

    expect(queue.briefPath('tarefa-1')).toBe(join(root, 'inbox', 'tarefa-1', 'brief.brief'));
    expect(queue.outDirectory('tarefa-1')).toBe(join(root, 'outbox', 'tarefa-1', 'out'));
    expect(queue.briefPath('..')).toBeUndefined();
  });

  it('lists finished tasks from done/ beside the waiting ones', async () => {
    const { render } = fakeRender();
    mkdirSync(join(root, 'done', 'antiga'), { recursive: true });
    writeFileSync(join(root, 'done', 'antiga', 'brief.brief'), '::titulo Antiga', 'utf8');
    drop('nova', '::titulo Nova');

    const { service: queue } = start(render, { autoRun: false });
    const view = await queue.view();

    expect(view.tasks.map((task) => [task.id, task.status])).toEqual([
      ['nova', 'pending'],
      ['antiga', 'done'],
    ]);
  });
});
