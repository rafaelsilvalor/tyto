import { err, ok } from '@tyto/core';
import {
  type ApplyOptions,
  type ApplyProgress,
  type Plan,
  type Table,
  type Verb,
  parseRecipe,
  runRecipe,
} from '@tyto/recipe';
import { describe, expect, it } from 'vitest';

import { type Plugin, type PluginHost, createPluginHost } from './host.js';
import {
  APPLY_CANCELLED,
  APPLY_CONTINUE_CALLS,
  APPLY_NOT_STARTED,
  APPLY_NO_ANSWER,
  APPLY_UNFINISHED,
  type AppliedBatch,
  type ApplyRequest,
  type RecipeRegistries,
  type RecipeVerbContribution,
  recipeRegistriesOf,
} from './recipes.js';

/**
 * Apply in process (TYTO-378, ADR 0170): what the host checks before it calls a plugin's
 * `apply`, how it batches the shown plan, and how it reads the answers. The same contribution
 * across a process boundary is `isolation/isolated-plugin.test.ts`'s.
 */

const NOW = '2026-11-07T12:00:00.000Z';

function rowsOf(count: number): Table {
  return {
    columns: [{ name: 'number', type: 'number', origin: 'test' }],
    rows: Array.from({ length: count }, (_, index) => ({
      key: `N-${String(index + 1)}`,
      values: { number: index + 1 },
      provenance: { source: 'test', id: `N-${String(index + 1)}`, fetchedAt: '2026-11-07' },
    })),
  };
}

type Applier = (
  request: ApplyRequest,
  call: number,
) => ReturnType<NonNullable<RecipeVerbContribution['apply']>>;

/** Answers `applied` for every operation, and a `rowKey` of its own that the host must ignore. */
const appliesAll: Applier = (request) =>
  ok({
    operations: request.operations.map(() => ({ status: 'applied', rowKey: 'NOT-THE-ROW' })),
  } as AppliedBatch);

function pluginOf(
  rows: number,
  apply: Applier | undefined,
  calls: ApplyRequest[],
  writes: readonly string[] = ['mark'],
): Plugin {
  return {
    id: 'first',
    manifest: {
      name: 'first',
      version: '0.1.0',
      engine: '>=0.1',
      contributes: ['recipe-verb'],
      permissions: [],
      namespace: 'demo',
      writes: ['mark', 'assign'],
    },
    activate: (host: PluginHost) => {
      host.registerRecipeVerb({
        id: 'demo.numbers',
        kind: 'source',
        arguments: [],
        page: () => ok({ table: rowsOf(rows) }),
      });
      host.registerRecipeVerb({
        id: 'demo.mark',
        kind: 'action',
        arguments: [{ name: 'label', type: 'text', positional: true, required: true }],
        writes,
        plan: ({ arguments: { label }, table }) => {
          const operations = table.rows.map((row) => ({
            write: 'mark',
            rowKey: row.key,
            description: `Mark ${row.key} as ${String(label)}`,
            payload: { id: row.key, expected: null },
          }));
          return ok({ target: 'demo items', operations, count: operations.length });
        },
        ...(apply === undefined
          ? {}
          : {
              apply: (request: ApplyRequest) => {
                calls.push(request);
                return apply(request, calls.length);
              },
            }),
      });
    },
  };
}

interface Planned {
  readonly host: ReturnType<typeof createPluginHost>;
  readonly registries: RecipeRegistries;
  readonly plan: Plan;
  readonly verb: Verb;
  readonly calls: ApplyRequest[];
}

async function planned(rows: number, apply: Applier | undefined): Promise<Planned> {
  const calls: ApplyRequest[] = [];
  const host = createPluginHost();
  const activated = host.tryActivate(pluginOf(rows, apply, calls));
  if (!activated.ok) throw new Error(activated.error[0]?.message);
  const registries = recipeRegistriesOf(host.registry, {
    now: () => NOW,
    sectionOf: () => ({ site: 'demo.example' }),
  });
  const parsed = parseRecipe('recipe test\ndemo.numbers\ndemo.mark done');
  if (!parsed.ok) throw new Error('the recipe must parse');
  const result = await runRecipe(parsed.value, {
    ...registries,
    resolveRecipe: () => Promise.resolve(err([])),
  });
  if (!result.ok) throw new Error('the run must start');
  const plan = result.value.cells[1]?.plan;
  const verb = registries.verbs.get('demo.mark');
  if (plan === undefined || verb?.apply === undefined) throw new Error('the cell must plan');
  return { host, registries, plan, verb, calls };
}

async function applied(setup: Planned, plan: Plan = setup.plan, options?: ApplyOptions) {
  const outcome = await setup.verb.apply?.(plan, options);
  if (outcome === undefined) throw new Error('the verb must apply');
  return outcome;
}

describe('apply, before any call (ADR 0170 decision 3)', () => {
  it('refuses with zero calls a kept plan whose write the updated verb no longer declares', async () => {
    const setup = await planned(3, appliesAll);
    // The plugin is updated between the plan and the click: `demo.mark` now writes only `assign`.
    setup.host.disposePlugin('first');
    const updatedCalls: ApplyRequest[] = [];
    const updated = setup.host.tryActivate(pluginOf(3, appliesAll, updatedCalls, ['assign']));
    if (!updated.ok) throw new Error(updated.error[0]?.message);

    const outcome = await applied(setup);
    expect(outcome.ok ? '' : outcome.error[0]?.code).toBe('E_RECIPE_APPLY');
    expect(outcome.ok ? '' : outcome.error[0]?.message).toContain(
      "operation 1 writes 'mark', and the verb declares assign",
    );
    expect(setup.calls).toHaveLength(0);
    expect(updatedCalls).toHaveLength(0);
  });

  it('applies through the updated verb when its writes still cover the plan', async () => {
    const setup = await planned(2, appliesAll);
    setup.host.disposePlugin('first');
    const updatedCalls: ApplyRequest[] = [];
    const updated = setup.host.tryActivate(pluginOf(2, appliesAll, updatedCalls));
    if (!updated.ok) throw new Error(updated.error[0]?.message);
    const outcome = await applied(setup);
    expect(outcome.ok).toBe(true);
    expect(setup.calls).toHaveLength(0);
    expect(updatedCalls).toHaveLength(1);
  });

  it('refuses a withdrawn verb, a verb with no apply, and a plan it did not answer', async () => {
    const withdrawn = await planned(2, appliesAll);
    withdrawn.host.disposePlugin('first');
    const gone = await applied(withdrawn);
    expect(gone.ok ? '' : gone.error[0]?.message).toBe(
      "Applying the plan of 'demo.mark' was refused: no installed plugin contributes the verb " +
        'any more.',
    );

    const onlyPlans = await planned(2, undefined);
    const unable = await applied(onlyPlans);
    expect(unable.ok ? '' : unable.error[0]?.message).toContain('its plugin gives it no apply');

    const copied = await planned(2, appliesAll);
    const copy = await applied(copied, JSON.parse(JSON.stringify(copied.plan)) as Plan);
    expect(copy.ok ? '' : copy.error[0]?.message).toContain('did not answer that plan');
    expect(copied.calls).toHaveLength(0);
  });
});

describe('apply, in batches (ADR 0170 decision 2)', () => {
  it('hands the shown plan over a hundred at a time and maps answers onto its rows', async () => {
    const setup = await planned(250, appliesAll);
    const outcome = await applied(setup);
    if (!outcome.ok) throw new Error(outcome.error[0]?.message);

    expect(setup.calls.map((call) => call.operations.length)).toEqual([100, 100, 50]);
    const [first] = setup.calls;
    expect(first?.arguments).toEqual({ label: 'done' });
    expect(first?.target).toBe('demo items');
    expect(first?.section).toEqual({ site: 'demo.example' });
    expect(first?.operations[0]).toEqual({
      write: 'mark',
      rowKey: 'N-1',
      description: 'Mark N-1 as done',
      payload: { id: 'N-1', expected: null },
    });
    expect(outcome.value.operations).toHaveLength(250);
    expect(outcome.value.operations[249]).toEqual({
      rowKey: 'N-250',
      status: 'applied',
      appliedAt: NOW,
    });
    // The plugin answered `NOT-THE-ROW` for every operation; the host kept the shown plan's.
    expect(outcome.value.operations.map((operation) => operation.rowKey)).toEqual(
      setup.plan.operations.map((operation) => operation.rowKey),
    );
  });

  it('keeps a failed operation with its reason, and stamps no time on it', async () => {
    const setup = await planned(2, (request) =>
      ok({
        operations: request.operations.map((operation) =>
          operation.rowKey === 'N-2'
            ? { status: 'failed', reason: 'N-2 was marked by somebody else' }
            : { status: 'applied' },
        ),
      }),
    );
    const outcome = await applied(setup);
    expect(outcome.ok && outcome.value.operations).toEqual([
      { rowKey: 'N-1', status: 'applied', appliedAt: NOW },
      { rowKey: 'N-2', status: 'failed', reason: 'N-2 was marked by somebody else' },
    ]);
  });

  /** Statuses by batch of a 250-operation plan whose `apply` misbehaves on `call`. */
  async function statusesWhen(misbehave: Applier) {
    const setup = await planned(250, misbehave);
    const outcome = await applied(setup);
    if (!outcome.ok) throw new Error(outcome.error[0]?.message);
    const { operations } = outcome.value;
    return {
      calls: setup.calls.length,
      batches: [operations.slice(0, 100), operations.slice(100, 200), operations.slice(200)].map(
        (batch) => [
          ...new Set(batch.map((operation) => `${operation.status}: ${operation.reason ?? ''}`)),
        ],
      ),
    };
  }

  /** Batch one applied, batch two with no answer, batch three never called. */
  const AFTER_SECOND = [
    ['applied: '],
    [`failed: ${APPLY_NO_ANSWER}`],
    ['skipped: an earlier batch had no answer'],
  ];

  it('fails a batch whose answer has the wrong length, and skips every later one uncalled', async () => {
    const result = await statusesWhen((request, call) =>
      call === 2 ? ok({ operations: [{ status: 'applied' }] }) : appliesAll(request, call),
    );
    expect(result).toEqual({ calls: 2, batches: AFTER_SECOND });
  });

  it('fails a batch whose apply throws or refuses, and skips the rest', async () => {
    const thrown = await statusesWhen((request, call) => {
      if (call === 2) throw new Error('the tracker is down');
      return appliesAll(request, call);
    });
    expect(thrown).toEqual({ calls: 2, batches: AFTER_SECOND });

    const refused = await statusesWhen((request, call) =>
      call === 2 ? err([]) : appliesAll(request, call),
    );
    expect(refused).toEqual({ calls: 2, batches: AFTER_SECOND });
  });

  it('fails a batch with a failed operation that says no reason, or one over 500 characters', async () => {
    for (const reason of [undefined, 'x'.repeat(501)]) {
      const result = await statusesWhen((request, call) =>
        call === 2
          ? ok({
              operations: request.operations.map(() => ({
                status: 'failed' as const,
                ...(reason === undefined ? {} : { reason }),
              })),
            })
          : appliesAll(request, call),
      );
      expect(result).toEqual({ calls: 2, batches: AFTER_SECOND });
    }
  });
});

/**
 * An upload that takes `needs` calls per operation, as a long write does: the plugin keeps how
 * far each one got (here a map, in a plugin its cache, ADR 0138) and answers `continue` with a
 * progress line until the last call (ADR 0216).
 */
function uploads(needs: (rowKey: string) => number): Applier {
  const sent = new Map<string, number>();
  return (request) =>
    ok({
      operations: request.operations.map((operation) => {
        const key = operation.rowKey ?? '';
        const parts = needs(key);
        const done = (sent.get(key) ?? 0) + 1;
        sent.set(key, done);
        return done < parts
          ? {
              status: 'continue' as const,
              progress: `sent ${String(done)} of ${String(parts)} parts`,
            }
          : { status: 'applied' as const };
      }),
    });
}

describe('apply, an operation in progress (ADR 0216)', () => {
  it('asks again for an operation that needs three calls, and finishes it in one Apply', async () => {
    const setup = await planned(
      2,
      uploads((key) => (key === 'N-1' ? 3 : 1)),
    );
    const progress: ApplyProgress[] = [];
    const outcome = await applied(setup, setup.plan, { onProgress: (each) => progress.push(each) });
    if (!outcome.ok) throw new Error(outcome.error[0]?.message);

    // The first call carries both; each later one only the operation still in progress.
    expect(setup.calls.map((call) => call.operations.map((each) => each.rowKey))).toEqual([
      ['N-1', 'N-2'],
      ['N-1'],
      ['N-1'],
    ]);
    // The operation handed back is the planned one, payload included.
    expect(setup.calls[2]?.operations[0]).toEqual(setup.plan.operations[0]);
    expect(outcome.value.operations).toEqual([
      { rowKey: 'N-1', status: 'applied', appliedAt: NOW },
      { rowKey: 'N-2', status: 'applied', appliedAt: NOW },
    ]);
    expect(progress).toEqual([
      { done: 1, total: 2, note: 'sent 1 of 3 parts' },
      { done: 1, total: 2, note: 'sent 2 of 3 parts' },
      { done: 2, total: 2 },
    ]);
  });

  it('asks nothing after a cancel, and reports the operation in progress unfinished', async () => {
    const setup = await planned(
      2,
      uploads((key) => (key === 'N-1' ? 3 : 1)),
    );
    // No DOM or Node type here: a cancel is anything with `aborted`.
    const cancel = { aborted: false };
    const outcome = await applied(setup, setup.plan, {
      cancel,
      // The person cancels while the first call's progress is shown.
      onProgress: () => {
        cancel.aborted = true;
      },
    });
    if (!outcome.ok) throw new Error(outcome.error[0]?.message);
    expect(setup.calls).toHaveLength(1);
    expect(outcome.value.operations).toEqual([
      { rowKey: 'N-1', status: 'failed', reason: APPLY_CANCELLED },
      { rowKey: 'N-2', status: 'applied', appliedAt: NOW },
    ]);
  });

  it('skips with no call the batches a cancel came before', async () => {
    const setup = await planned(150, appliesAll);
    // No DOM or Node type here: a cancel is anything with `aborted`.
    const cancel = { aborted: false };
    const outcome = await applied(setup, setup.plan, {
      cancel,
      onProgress: () => {
        cancel.aborted = true;
      },
    });
    if (!outcome.ok) throw new Error(outcome.error[0]?.message);
    expect(setup.calls).toHaveLength(1);
    expect(outcome.value.operations[99]?.status).toBe('applied');
    expect(outcome.value.operations[100]).toEqual({
      rowKey: 'N-101',
      status: 'skipped',
      reason: APPLY_NOT_STARTED,
    });
  });

  it('stops asking at the ceiling, and reports the operation unfinished', async () => {
    const setup = await planned(
      1,
      uploads(() => Number.POSITIVE_INFINITY),
    );
    const outcome = await applied(setup);
    if (!outcome.ok) throw new Error(outcome.error[0]?.message);
    expect(setup.calls).toHaveLength(1 + APPLY_CONTINUE_CALLS);
    expect(outcome.value.operations).toEqual([
      { rowKey: 'N-1', status: 'failed', reason: APPLY_UNFINISHED },
    ]);
  });

  it('fails as no answer a later call that throws, and skips every later batch', async () => {
    const continuing = uploads((key) => (key === 'N-1' ? 3 : 1));
    const result = await statusesOf(250, (request, call) => {
      if (call === 2) throw new Error('the upload session expired');
      return continuing(request, call);
    });
    expect(result.calls).toBe(2);
    expect(result.first).toEqual({ rowKey: 'N-1', status: 'failed', reason: APPLY_NO_ANSWER });
    expect(result.second).toEqual({ rowKey: 'N-2', status: 'applied', appliedAt: NOW });
    expect(result.later).toEqual(['skipped: an earlier batch had no answer']);
  });

  it('fails as no answer a progress line on another status, or one over 80 characters', async () => {
    const answers = [
      { status: 'applied' as const, progress: 'done' },
      { status: 'continue' as const, progress: 'x'.repeat(81) },
      { status: 'continue' as const, progress: '' },
    ];
    for (const answer of answers) {
      const result = await statusesOf(2, (request) =>
        ok({ operations: request.operations.map(() => answer) }),
      );
      expect(result.calls).toBe(1);
      expect(result.first?.reason).toBe(APPLY_NO_ANSWER);
    }
  });

  // Version skew: a plugin that answers `continue` to a host on protocol 27 or earlier gets the
  // outcome that host gives any status it does not know: the batch fails as no answer.
  it('fails as no answer a status this host does not know, as continue was to a host on 27', async () => {
    const result = await statusesOf(2, (request) =>
      ok({
        operations: request.operations.map(() => ({ status: 'later' })),
      } as unknown as AppliedBatch),
    );
    expect(result.calls).toBe(1);
    expect(result.first).toEqual({ rowKey: 'N-1', status: 'failed', reason: APPLY_NO_ANSWER });
  });
});

/** An Apply of `rows` operations: its calls, its first two outcomes, and every later status. */
async function statusesOf(rows: number, apply: Applier) {
  const setup = await planned(rows, apply);
  const outcome = await applied(setup);
  if (!outcome.ok) throw new Error(outcome.error[0]?.message);
  const [first, second, ...rest] = outcome.value.operations;
  return {
    calls: setup.calls.length,
    first,
    second,
    later: [...new Set(rest.slice(98).map((each) => `${each.status}: ${each.reason ?? ''}`))],
  };
}

describe('apply at registration', () => {
  it("lets an action without 'apply' register, and refuses a source with one", () => {
    const calls: ApplyRequest[] = [];
    expect(createPluginHost().tryActivate(pluginOf(1, undefined, calls)).ok).toBe(true);
    const source = createPluginHost().tryActivate({
      ...pluginOf(1, undefined, calls),
      activate: (host) => {
        host.registerRecipeVerb({
          id: 'demo.numbers',
          kind: 'source',
          arguments: [],
          page: () => ok({ table: rowsOf(1) }),
          apply: () => ok({ operations: [] }),
        });
      },
    });
    expect(source.ok ? '' : source.error[0]?.message).toContain(
      "registered the verb 'demo.numbers' as a source with 'apply', and only an action or a sink writes",
    );
  });
});
