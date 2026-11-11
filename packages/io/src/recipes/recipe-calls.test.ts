import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ok } from '@tyto/core';
import type { CallRequest, RecipeContributions, RecipeVerbContribution } from '@tyto/plugin-api';
import { CALL_DEADLINE_MS, type RunClock, type Table } from '@tyto/recipe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type RecipeCredentials,
  type RecipeFetch,
  type RecipeFetchAnswer,
  type RecipeFetchInit,
  recipeCallPorts,
} from './recipe-calls.js';
import { type RecipePlace, createRecipeRunner } from './recipe-runner.js';

/**
 * `call`'s adapter (TYTO-671, ADR 0193), with the platform's `fetch` replaced by a fake that
 * behaves as the real one does: it follows a 3xx unless told `redirect: 'manual'`, rejects with
 * an abort when its signal fires, and holds a body the adapter must never read. The verb only
 * sends `https:`, and the fake is how this test reaches an endpoint without the network.
 */

const TOKEN = 'tok-5d1c-never-shown';
const NOW = '2026-11-11T12:00:00.000Z';
const HOST = 'hooks.example.com';
const URL_RUN = `https://${HOST}/run`;

/** One request as the fake endpoint saw it. */
interface Received {
  readonly url: string;
  readonly init: RecipeFetchInit;
}

/** What an endpoint answers: a status, where a 3xx points, a body; `hang` never answers. */
type Endpoint = (received: Received) => {
  readonly status: number;
  readonly location?: string;
  readonly body?: string;
  readonly hang?: true;
  readonly throws?: Error;
};

class FakeNetwork {
  readonly endpoints = new Map<string, Endpoint>();
  readonly received: Received[] = [];
  /** How many times anything read an answer's body. */
  bodyReads = 0;

  readonly fetch: RecipeFetch = (url, init) => {
    this.received.push({ url, init });
    return this.answer(url, init, 0);
  };

  private async answer(
    url: string,
    init: RecipeFetchInit,
    hops: number,
  ): Promise<RecipeFetchAnswer & { text(): Promise<string> }> {
    const endpoint = this.endpoints.get(url);
    if (endpoint === undefined)
      throw new TypeError('fetch failed', { cause: new Error('ENOTFOUND') });
    const answer = endpoint({ url, init });
    if (answer.throws !== undefined) throw answer.throws;
    if (answer.hang === true) {
      return new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      });
    }
    // What the platform does: follow a 3xx unless told not to, carrying the headers along.
    if (answer.status >= 300 && answer.status < 400 && answer.location !== undefined) {
      if (init.redirect !== 'manual' && hops < 5) {
        this.received.push({ url: answer.location, init });
        return this.answer(answer.location, init, hops + 1);
      }
    }
    const text = answer.body ?? '';
    return {
      status: answer.status,
      body: { cancel: () => Promise.resolve() },
      text: () => {
        this.bodyReads += 1;
        return Promise.resolve(text);
      },
    };
  }
}

/** Lets every promise and I/O callback that is ready run, without a timer. */
const settle = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

function credentials(stored: Record<string, string>): RecipeCredentials {
  return { read: (name) => Promise.resolve(stored[name]) };
}

const request = (more: Partial<CallRequest> = {}): CallRequest => ({
  method: 'POST',
  url: URL_RUN,
  credential: 'routine',
  body: '{"key":"T-1"}',
  deadlineMs: CALL_DEADLINE_MS,
  ...more,
});

function ports(network: FakeNetwork, hosts: readonly string[] | undefined = [HOST]) {
  return recipeCallPorts({
    hosts: () => hosts,
    credentials: credentials({ routine: TOKEN }),
    sends: true,
    fetch: network.fetch,
  });
}

async function sent(network: FakeNetwork, call: CallRequest, hosts?: readonly string[]) {
  const send = ports(network, hosts ?? [HOST]).send;
  if (send === undefined) throw new Error('this host sends');
  return send(call);
}

const problem = (answer: Awaited<ReturnType<typeof sent>>) =>
  answer.ok ? undefined : answer.error.map((found) => found.message).join('; ');

describe('recipeCallPorts', () => {
  it('posts the body as JSON with the stored token in the header, and no redirect followed', async () => {
    const network = new FakeNetwork();
    network.endpoints.set(URL_RUN, () => ({ status: 202 }));
    const answer = await sent(network, request());
    expect(answer).toEqual(ok({ status: 202 }));
    expect(network.received).toHaveLength(1);
    const [received] = network.received;
    expect(received?.init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: '{"key":"T-1"}',
      redirect: 'manual',
    });
  });

  it('answers a 3xx as its status, so the header never reaches the host it points to', async () => {
    const network = new FakeNetwork();
    network.endpoints.set(URL_RUN, () => ({ status: 302, location: 'https://evil.example.net/' }));
    network.endpoints.set('https://evil.example.net/', () => ({ status: 200 }));
    expect(await sent(network, request())).toEqual(ok({ status: 302 }));
    expect(network.received.map(({ url }) => url)).toEqual([URL_RUN]);
  });

  it('gives up at the deadline and says so', async () => {
    const network = new FakeNetwork();
    network.endpoints.set(URL_RUN, () => ({ status: 200, hang: true }));
    const answer = await sent(network, request({ deadlineMs: 20 }));
    expect(problem(answer)).toContain(`${HOST} did not answer within 20 ms`);
  });

  it('checks the host the platform parses against the list, and sends nothing else', async () => {
    const network = new FakeNetwork();
    network.endpoints.set('https://evil.example.net/run', () => ({ status: 200 }));
    const answer = await sent(network, request({ url: 'https://evil.example.net/run' }));
    expect(problem(answer)).toContain(
      "evil.example.net is not in the workspace's recipes.call.hosts",
    );
    // A host the pattern reads as a name and the parser as an address.
    const numeric = await sent(network, request({ url: 'https://0x7f.1/run' }), ['0x7f.1']);
    expect(problem(numeric)).toContain('127.0.0.1 is not in');
    // No list at all: a recipe out of any trusted workspace.
    const none = recipeCallPorts({
      hosts: () => undefined,
      credentials: credentials({ routine: TOKEN }),
      sends: true,
      fetch: network.fetch,
    });
    expect(problem((await none.send?.(request())) ?? ok({ status: 0 }))).toContain('trusted');
    expect(network.received).toEqual([]);
  });

  it('refuses an address that is not https, or carries a user or a fragment', async () => {
    const network = new FakeNetwork();
    for (const url of [
      'http://hooks.example.com/run',
      `https://me:pw@${HOST}/run`,
      `${URL_RUN}#x`,
    ]) {
      expect((await sent(network, request({ url }))).ok).toBe(false);
    }
    expect(network.received).toEqual([]);
  });

  it('never reads the answer body, whatever the status', async () => {
    const network = new FakeNetwork();
    network.endpoints.set(URL_RUN, () => ({ status: 500, body: `echo: Bearer ${TOKEN}` }));
    expect(await sent(network, request())).toEqual(ok({ status: 500 }));
    expect(network.bodyReads).toBe(0);
  });

  it('replaces the token with [credential] in every failure it reports', async () => {
    const network = new FakeNetwork();
    network.endpoints.set(URL_RUN, () => ({
      status: 0,
      throws: new TypeError(`header Bearer ${TOKEN} refused`, {
        cause: new Error(`socket closed after ${TOKEN}`),
      }),
    }));
    const said = problem(await sent(network, request())) ?? '';
    expect(said).toContain('header Bearer [credential] refused');
    expect(said).toContain('socket closed after [credential]');
    expect(said).not.toContain(TOKEN);
  });

  it('answers whether a credential is stored, never its value, and an empty one is none', async () => {
    const lent = recipeCallPorts({
      hosts: () => [HOST],
      credentials: credentials({ routine: TOKEN, blank: '' }),
      sends: true,
    });
    expect(await lent.hasCredential('routine')).toBe(true);
    expect(await lent.hasCredential('blank')).toBe(false);
    expect(await lent.hasCredential('other')).toBe(false);
    const network = new FakeNetwork();
    expect(problem(await sent(network, request({ credential: 'other' })))).toContain(
      "no credential named 'other'",
    );
  });

  it('lends no send to a host that only previews', () => {
    const lent = recipeCallPorts({
      hosts: () => [HOST],
      credentials: credentials({}),
      sends: false,
    });
    expect(lent.send).toBeUndefined();
  });
});

/**
 * The card's acceptance, through the runner as the desktop and the CLI compose it (ADR 0188):
 * `last`, `where` and `remember` around `call`, against the fake endpoint, in a scratch
 * `TYTO_HOME` with the real state store.
 */
describe('call through the recipe runner', () => {
  const clock: RunClock = { now: () => new Date(NOW), offsetMinutes: () => 0 };

  const row = (key: string, title: string) => ({
    key,
    values: { key, title },
    provenance: { source: 'demo', id: key, fetchedAt: '2026-11-11T09:00:00.000Z' },
  });
  const ROWS: Table = {
    columns: [
      { name: 'key', type: 'text', origin: 'demo' },
      { name: 'title', type: 'text', origin: 'demo' },
    ],
    rows: [row('T-0', 'Aula 1'), row('T-1', 'Aula "2"')],
  };

  const source: RecipeVerbContribution = {
    id: 'demo.rows',
    kind: 'source',
    arguments: [],
    page: () => Promise.resolve(ok({ table: ROWS })),
  };
  const contributions: RecipeContributions = {
    recipeVerbs: () => [source],
    ownedRecipeVerbs: () => [{ plugin: 'demo', verb: source }],
    recipeDerivations: () => [],
  };

  const dispatch = (url: string) =>
    [
      'recipe dispatch',
      'demo.rows',
      'last dispatched',
      'where last_stored_at is empty',
      `call url=${url} token=routine body={"key": "{key|}", "title": "{title|}"}`,
      'remember dispatched columns=title',
      '',
    ].join('\n');
  const CALL_CELL = 3;

  let scratch: string;
  let workspace: string;
  let recipePath: string;

  beforeEach(async () => {
    scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-recipe-call-')));
    workspace = join(scratch, 'promo');
    await mkdir(join(workspace, 'recipes'), { recursive: true });
    recipePath = join(workspace, 'recipes', 'dispatch.recipe');
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  function harness(network: FakeNetwork, trust: RecipePlace['trust'] = 'trusted') {
    const runner = createRecipeRunner({
      contributions,
      placeOf: () => Promise.resolve(trust === 'none' ? { trust } : { trust, folder: workspace }),
      sectionFor: () => undefined,
      home: join(scratch, 'home'),
      clock: () => clock,
      calls: {
        hostsFor: () => [HOST],
        credentials: credentials({ routine: TOKEN }),
        sends: true,
        fetch: network.fetch,
      },
    });
    // Each run starts fresh, as the next scheduled run or a reopened recipe does, so `last`
    // reads the store again instead of the table the cell kept.
    const run = (text: string) =>
      runner.run({ documentId: 'tab-1', text, path: recipePath, explicit: true, fresh: true });
    const apply = (planId: number) =>
      runner.apply({ documentId: 'tab-1', index: CALL_CELL, planId, path: recipePath });
    return { run, apply };
  }

  it('plans 2 requests for 2 rows, sends them on Apply with the token, then plans 0', async () => {
    const network = new FakeNetwork();
    network.endpoints.set(URL_RUN, () => ({ status: 200 }));
    const { run, apply } = harness(network);

    const first = await run(dispatch(URL_RUN));
    const cell = first.cells[CALL_CELL];
    expect(cell?.diagnostics).toEqual([]);
    expect(cell?.plan?.count).toBe(2);
    expect(cell?.plan?.target).toBe(`requests to ${HOST}`);
    expect(network.received).toEqual([]);
    expect(JSON.stringify(first)).not.toContain(TOKEN);

    const applied = await apply(cell?.planId ?? -1);
    expect(applied?.applied?.operations).toEqual([
      { rowKey: 'T-0', status: 'applied', appliedAt: NOW },
      { rowKey: 'T-1', status: 'applied', appliedAt: NOW },
    ]);
    expect(applied?.diagnostics).toEqual([]);
    expect(network.received.map(({ init }) => init.headers['authorization'])).toEqual([
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`,
    ]);
    expect(network.received.map(({ init }) => JSON.parse(init.body) as unknown)).toEqual([
      { key: 'T-0', title: 'Aula 1' },
      { key: 'T-1', title: 'Aula "2"' },
    ]);

    const second = await run(dispatch(URL_RUN));
    expect(second.cells[CALL_CELL]?.plan?.count).toBe(0);
  });

  it('refuses at plan time a host not in the list', async () => {
    const network = new FakeNetwork();
    const { run } = harness(network);
    const answer = await run(dispatch('https://evil.example.net/run'));
    const cell = answer.cells[CALL_CELL];
    expect(cell?.status).toBe('failed');
    expect(cell?.diagnostics.map(({ code }) => code)).toEqual(['E_RECIPE_CALL']);
    expect(cell?.diagnostics[0]?.message).toContain('recipes.call.hosts');
  });

  it('plans nothing in a restricted folder, whatever the list says', async () => {
    const network = new FakeNetwork();
    const answer = await harness(network, 'restricted').run(dispatch(URL_RUN));
    const cell = answer.cells[CALL_CELL];
    expect(cell?.diagnostics.map(({ code }) => code)).toEqual(['E_RECIPE_CALL']);
    expect(cell?.diagnostics[0]?.message).toContain('trusted workspace');
  });

  it('fails a row the endpoint redirects, with the status and nothing of the body', async () => {
    const network = new FakeNetwork();
    network.endpoints.set(URL_RUN, ({ init }) =>
      init.body.includes('"T-1"')
        ? { status: 302, location: 'https://evil.example.net/', body: `moved ${TOKEN}` }
        : { status: 200 },
    );
    network.endpoints.set('https://evil.example.net/', () => ({ status: 200 }));
    const { run, apply } = harness(network);
    const first = await run(dispatch(URL_RUN));
    const applied = await apply(first.cells[CALL_CELL]?.planId ?? -1);
    expect(applied?.applied?.operations).toEqual([
      { rowKey: 'T-0', status: 'applied', appliedAt: NOW },
      { rowKey: 'T-1', status: 'failed', reason: `${HOST} answered HTTP 302` },
    ]);
    expect(network.received.map(({ url }) => url)).toEqual([URL_RUN, URL_RUN]);
    // The failed row is the only one planned again.
    const second = await run(dispatch(URL_RUN));
    expect(second.cells[CALL_CELL]?.plan?.operations.map(({ rowKey }) => rowKey)).toEqual(['T-1']);
  });

  it('fails a row past the verb deadline of 30 seconds, and still sends the next', async () => {
    const network = new FakeNetwork();
    network.endpoints.set(URL_RUN, ({ init }) =>
      init.body.includes('"T-0"') ? { status: 200, hang: true } : { status: 200 },
    );
    const { run, apply } = harness(network);
    const first = await run(dispatch(URL_RUN));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const applying = apply(first.cells[CALL_CELL]?.planId ?? -1);
      while (network.received.length === 0) await settle();
      vi.advanceTimersByTime(CALL_DEADLINE_MS - 1);
      await settle();
      expect(network.received).toHaveLength(1);
      vi.advanceTimersByTime(1);
      const applied = await applying;
      expect(applied?.applied?.operations).toEqual([
        {
          rowKey: 'T-0',
          status: 'failed',
          reason: `could not reach ${HOST}: 'call' sent nothing: ${HOST} did not answer within ${String(CALL_DEADLINE_MS)} ms`,
        },
        { rowKey: 'T-1', status: 'applied', appliedAt: NOW },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
