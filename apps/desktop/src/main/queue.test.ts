import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Diagnostic } from '@tyto/core';
import { type BriefSource, RESULT_FILE, fsInbox, renderResult } from '@tyto/io';
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
function fakeRender(before?: (request: ExportRequest) => void | Promise<void>) {
  const calls: ExportRequest[] = [];
  const render = async (request: ExportRequest): Promise<ExportProgress> => {
    calls.push(request);
    await before?.(request);
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
    return {
      status: 'finished',
      directory: request.directory,
      total: 1,
      done: 1,
      failed: diagnostics.length,
      result,
      diagnostics,
    };
  };
  return { calls, render };
}

/**
 * What the test waits on instead of the clock (TYTO-198). A deadline polled against the real
 * filesystem fails on a loaded machine with nothing wrong; the queue already says when
 * something changed (`onChange`, which the app pushes as `queue:changed`), and the sweep's
 * listing is a fact that can be counted.
 */
let changeWaiters: (() => void)[] = [];
let listings = 0;
let listingWaiters: { at: number; done: () => void }[] = [];

beforeEach(() => {
  changeWaiters = [];
  listings = 0;
  listingWaiters = [];
});

/** Resolves on the queue's next `onChange`. Armed before the look that might miss it. */
function nextChange(): Promise<void> {
  return new Promise((done) => {
    changeWaiters.push(done);
  });
}

/**
 * Resolves once the inbox has been listed `count` more times. Nothing else lists it while a
 * test waits here, so these are sweeps, and the sweep before the last one has finished
 * handing its tasks over — which is what "a few sweeps later, nothing ran" needs.
 */
function afterSweeps(count: number): Promise<void> {
  return new Promise((done) => {
    listingWaiters.push({ at: listings + count, done });
  });
}

/** The inbox the app composes, counting its listings for `afterSweeps`. */
function countedInbox(folder: string): BriefSource {
  const inbox = fsInbox({ root: join(folder, 'inbox'), done: join(folder, 'done') });
  return {
    pull() {
      listings += 1;
      listingWaiters = listingWaiters.filter((waiter) => {
        if (waiter.at > listings) return true;
        waiter.done();
        return false;
      });
      return inbox.pull();
    },
    ack: (id) => inbox.ack(id),
  };
}

function start(
  render: (request: ExportRequest) => Promise<ExportProgress>,
  options: {
    autoRun: boolean;
    onError?: (message: string, cause: unknown) => void;
    onMoved?: (from: string, to: string) => void;
    kinds?: Record<string, readonly string[]>;
  },
) {
  const onChange = vi.fn(() => {
    const waiting = changeWaiters;
    changeWaiters = [];
    for (const done of waiting) done();
  });
  service = createQueueService({
    sources: (folder) => ({
      inbox: countedInbox(folder),
      done: fsInbox({ root: join(folder, 'done') }),
    }),
    render,
    folder: root,
    autoRun: options.autoRun,
    onChange,
    intervalMs: 20,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.onMoved === undefined ? {} : { onMoved: options.onMoved }),
    ...(options.kinds === undefined ? {} : { kinds: options.kinds }),
  });
  return { service, onChange };
}

/**
 * The queue's view once `predicate` holds, looked at again each time the queue announces a
 * change. No deadline of its own: a queue that never gets there fails on the test's timeout.
 */
async function until(
  queue: QueueService,
  predicate: (view: QueueView) => boolean,
): Promise<QueueView> {
  for (;;) {
    const changed = nextChange();
    const view = await queue.view();
    if (predicate(view)) return view;
    await changed;
  }
}

const statusOf = (view: QueueView, id: string) => view.tasks.find((task) => task.id === id)?.status;

describe('with auto-run off', () => {
  it('lists a dropped folder as pending, says so, and renders nothing', async () => {
    const { calls, render } = fakeRender();
    const { service: queue } = start(render, { autoRun: false });

    // The sweep noticing it is what makes the panel redraw while nobody clicks. Armed before
    // the drop, so a sweep that is quick about it cannot be missed.
    const noticed = nextChange();
    drop('tarefa-1', '::titulo Olá');
    await noticed;
    const view = await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

    expect(view.inbox).toBe(join(root, 'inbox'));
    // A few sweeps later, still nothing rendered.
    await afterSweeps(3);
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

  it('asks the export to remove what the previous run left in out/ (ADR 0059)', async () => {
    // The removal itself is `@tyto/io`'s and tested there; the queue's part is asking for
    // it. Without the flag, a retry of a brief that lost slides keeps them (TYTO-199).
    const { calls, render } = fakeRender();
    const { service: queue } = start(render, { autoRun: false });
    drop('tarefa-1', '::titulo Olá');
    await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

    await queue.run('tarefa-1');

    expect(calls.map((call) => call.removeLeftovers)).toEqual([true]);
  });
});

describe('the file types a folder produces (TYTO-188)', () => {
  const kindsOf = (calls: readonly ExportRequest[]) =>
    calls.map((call) => call.outputs.map((output) => output.kind));

  it('produces PNG alone in a folder nobody chose for, as the queue always did (ADR 0044)', async () => {
    const { calls, render } = fakeRender();
    const { service: queue } = start(render, { autoRun: false });
    drop('tarefa-1', '::titulo Olá');
    await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

    await queue.run('tarefa-1');

    expect(kindsOf(calls)).toEqual([['png']]);
    expect((await queue.view()).kinds).toEqual(['png']);
  });

  it("renders the next task in the kinds chosen, and answers with every folder's choice", async () => {
    const { calls, render } = fakeRender();
    const elsewhere = join(root, '..', 'outra-fila');
    const { service: queue } = start(render, { autoRun: false, kinds: { [elsewhere]: ['jpeg'] } });
    drop('tarefa-1', '::titulo Olá');
    await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

    const saved = queue.setKinds(['png', 'svg', 'png']);
    await queue.run('tarefa-1');

    expect(kindsOf(calls)).toEqual([['png', 'svg']]);
    expect((await queue.view()).kinds).toEqual(['png', 'svg']);
    // The other folder's choice survives, because the whole record is what gets saved.
    expect(saved).toEqual({ [elsewhere]: ['jpeg'], [root]: ['png', 'svg'] });
  });

  it('reads a saved choice for the folder, however the path was spelled', async () => {
    const { calls, render } = fakeRender();
    const { service: queue } = start(render, { autoRun: false, kinds: { [`${root}/`]: ['svg'] } });
    drop('tarefa-1', '::titulo Olá');
    await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

    await queue.run('tarefa-1');

    expect(kindsOf(calls)).toEqual([['svg']]);
  });

  it('asks the export to drop a kind it cannot produce rather than fail the task (ADR 0061)', async () => {
    const { calls, render } = fakeRender();
    const { service: queue } = start(render, { autoRun: false, kinds: { [root]: ['pdf'] } });
    drop('tarefa-1', '::titulo Olá');
    await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

    await queue.run('tarefa-1');

    expect(calls.map((call) => call.dropUnavailableKinds)).toEqual([true]);
  });

  it('refuses an empty choice, which would make a folder that produces nothing', () => {
    const { render } = fakeRender();
    const { service: queue } = start(render, { autoRun: false });

    expect(queue.setKinds([])).toEqual({});
  });
});

describe('with auto-run on', () => {
  it('says where a brief went when it moves a task to done/', async () => {
    const { render } = fakeRender();
    const moved: [string, string][] = [];
    const { service: queue } = start(render, {
      autoRun: false,
      onMoved: (from, to) => {
        moved.push([from, to]);
      },
    });
    drop('tarefa-1', '::titulo Olá');
    await until(queue, (current) => statusOf(current, 'tarefa-1') === 'pending');

    await queue.run('tarefa-1');

    const to = join(root, 'done', 'tarefa-1', 'brief.brief');
    expect(moved).toEqual([[join(root, 'inbox', 'tarefa-1', 'brief.brief'), to]]);
    // The path it names is the one the file is actually at, not a guess about the layout.
    expect(existsSync(to)).toBe(true);
  });

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
    await afterSweeps(3);
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
    await afterSweeps(3);

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
    await afterSweeps(3);

    expect(view.tasks[0]?.diagnostics.map((item) => item.code)).toEqual(['E_UNKNOWN_TEMPLATE']);
    expect(calls).toHaveLength(0);
  });
});

describe('one consumer per folder', () => {
  it('reports a task somebody else moved first as a failure on the task, not a crash', async () => {
    // A `tyto watch` on the same folder, standing in: it finishes the task and moves it to
    // done/ while this render is still going, so this side's rename finds nothing. It acks
    // through its own `fsInbox`, as `tyto watch` does: a bare rename here races this queue's
    // sweep reading the brief, and fails the test on Windows for a reason that is not the
    // test's (TYTO-198).
    const { render } = fakeRender(async (request) => {
      if (request.label !== 'tarefa-1') return;
      await fsInbox({ root: join(root, 'inbox'), done: join(root, 'done') }).ack('tarefa-1');
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

    expect(await service.view()).toEqual({
      folder: null,
      inbox: null,
      autoRun: true,
      kinds: ['png'],
      tasks: [],
    });
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
