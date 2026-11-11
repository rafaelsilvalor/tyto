import { type Diagnostic, diagnostic, err, ok } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { tasks } from './__fixtures__/flows.js';
import { memoryState } from './__fixtures__/state-harness.js';
import {
  CALL_BODY_LIMIT_BYTES,
  CALL_DEADLINE_MS,
  type CallPorts,
  type CallRequest,
  httpsHost,
} from './call.js';
import { parseRecipe } from './parse.js';
import type { Plan } from './plan.js';
import { type VerbRegistry, createDerivationRegistry, createVerbRegistry } from './registry.js';
import { runRecipe } from './run.js';
import { type RecipeState, type StateWrite, stateToCommit } from './state.js';
import type { Table } from './table.js';

const TOKEN = 'tok-3f9a-never-shown';
const NOW = '2026-11-11T12:00:00.000Z';

/** What a fake endpoint answers: a status, where a 3xx points, and a body never passed on. */
interface Answer {
  readonly status: number;
  readonly location?: string;
  readonly body?: string;
}

/** One request as it reached a fake endpoint, the header the host set included. */
interface Received {
  readonly url: string;
  readonly authorization: string;
  readonly body: string;
}

/**
 * A host in memory, keeping the contract `CallPorts.send` states: it reads the credential and
 * sets the header itself, checks the host again, follows no redirect and answers the status
 * alone. Endpoints are by URL; an endpoint that answers nothing gives up as the deadline would.
 */
class FakeHost implements CallPorts {
  allowed: readonly string[] | undefined = ['hooks.example.com'];
  readonly credentials = new Map<string, string>([['routine', TOKEN]]);
  readonly endpoints = new Map<string, (request: Received) => Answer | undefined>();
  readonly received: Received[] = [];
  readonly deadlines: number[] = [];
  sends = true;

  hosts(): readonly string[] | undefined {
    return this.allowed;
  }
  hasCredential(name: string): Promise<boolean> {
    return Promise.resolve(this.credentials.has(name));
  }
  get send(): CallPorts['send'] {
    return this.sends ? (request) => Promise.resolve(this.deliver(request)) : undefined;
  }
  now(): string {
    return NOW;
  }

  private deliver(request: CallRequest) {
    this.deadlines.push(request.deadlineMs);
    const host = httpsHost(request.url);
    if (!host.ok || !(this.allowed ?? []).includes(host.value)) {
      return err([refusal('the host is not allowed')]);
    }
    const value = this.credentials.get(request.credential);
    if (value === undefined) return err([refusal('no credential')]);
    const received = { url: request.url, authorization: `Bearer ${value}`, body: request.body };
    this.received.push(received);
    const answer = this.endpoints.get(request.url)?.(received);
    if (answer === undefined) {
      return err([refusal(`gave no answer within ${String(request.deadlineMs)} ms`)]);
    }
    // A 3xx is answered as it is: following `location` would carry the header to its host.
    return ok({ status: answer.status });
  }
}

function refusal(problem: string): Diagnostic {
  return diagnostic('E_RECIPE_CALL', { problem });
}

const ROWS = tasks(
  ['title', 'course'],
  [
    ['Aula 1', 'Direito "Constitucional"'],
    ['Aula 2', 'Português'],
  ],
);

const URL = 'https://hooks.example.com/run';
const BODY = '{"key": "{key|}", "title": "{title|}", "meta": {"course": "{course|}", "n": 1}}';
const CALL = `call url=${URL} token=routine body=${BODY}`;

interface Ran {
  readonly source: string;
  readonly verbs: VerbRegistry;
  readonly plan: Plan | undefined;
  readonly table: Table | undefined;
  readonly errors: readonly Diagnostic[];
  readonly at: readonly string[];
  readonly remembers: readonly StateWrite[];
}

async function run(
  lines: readonly string[],
  host: CallPorts | undefined,
  options: { state?: RecipeState; input?: Table; files?: Record<string, unknown> } = {},
): Promise<Ran> {
  const source = ['recipe dispatch', ...lines].join('\n');
  const recipe = parseRecipe(source);
  if (!recipe.ok) throw new Error(recipe.error.map(({ message }) => message).join('\n'));
  const verbs = createVerbRegistry({ calls: host });
  const files = options.files ?? {};
  const result = await runRecipe(recipe.value, {
    input: options.input ?? ROWS,
    verbs,
    derivations: createDerivationRegistry(),
    resolveRecipe: () => Promise.resolve(err([])),
    resolveData: (path) => Promise.resolve(path in files ? ok(files[path]) : err([])),
    state: options.state ?? memoryState(),
  });
  if (!result.ok) throw new Error('the run must start');
  const errors = result.value.cells
    .flatMap((cell) => cell.diagnostics)
    .filter((found) => found.severity === 'error');
  return {
    source,
    verbs,
    plan: result.value.cells.find((cell) => cell.plan !== undefined)?.plan,
    table: result.value.table,
    errors,
    at: errors.map((found) =>
      found.range === undefined ? '' : source.slice(found.range.start, found.range.end),
    ),
    remembers: result.value.remembers,
  };
}

async function applied(ran: Ran) {
  if (ran.plan === undefined) throw new Error('a plan');
  const answer = await ran.verbs.get('call')?.apply?.(ran.plan);
  if (answer === undefined) throw new Error('call must apply');
  return answer;
}

describe('call', () => {
  it('plans one POST per row and sends nothing while it runs', async () => {
    const host = new FakeHost();
    const ran = await run([CALL], host);
    expect(ran.errors).toEqual([]);
    expect(host.received).toEqual([]);
    expect(ran.plan?.target).toBe('requests to hooks.example.com');
    expect(ran.plan?.operations).toEqual([
      {
        write: 'request',
        rowKey: 'T-0',
        description: `POST ${URL} {"key":"T-0","title":"Aula 1","meta":{"course":"Direito \\"Constitucional\\"","n":1}}`,
        payload: { url: URL, bytes: 83 },
      },
      {
        write: 'request',
        rowKey: 'T-1',
        description: `POST ${URL} {"key":"T-1","title":"Aula 2","meta":{"course":"Português","n":1}}`,
        payload: { url: URL, bytes: 67 },
      },
    ]);
    // The table passes through, so `remember` after it reads the same rows.
    expect(ran.table).toEqual(ROWS);
  });

  it('sends on Apply what the plan showed, the stored token in the header', async () => {
    const host = new FakeHost();
    host.endpoints.set(URL, () => ({ status: 202 }));
    const answer = await applied(await run([CALL], host));
    expect(answer.ok && answer.value.operations).toEqual([
      { rowKey: 'T-0', status: 'applied', appliedAt: NOW },
      { rowKey: 'T-1', status: 'applied', appliedAt: NOW },
    ]);
    expect(host.received.map(({ authorization }) => authorization)).toEqual([
      `Bearer ${TOKEN}`,
      `Bearer ${TOKEN}`,
    ]);
    expect(JSON.parse(host.received[0]?.body ?? '')).toEqual({
      key: 'T-0',
      title: 'Aula 1',
      meta: { course: 'Direito "Constitucional"', n: 1 },
    });
    expect(host.deadlines).toEqual([CALL_DEADLINE_MS, CALL_DEADLINE_MS]);
  });

  it('reads the body from a data file, where a template writes {column}', async () => {
    const host = new FakeHost();
    const ran = await run([`call url=${URL} token=routine body=@./call.json#/routine`], host, {
      files: { './call.json': { routine: { id: '{key}', tags: ['{title|upper}', true] } } },
    });
    expect(ran.errors).toEqual([]);
    expect(ran.plan?.operations[1]?.description).toBe(
      `POST ${URL} {"id":"T-1","tags":["AULA 2",true]}`,
    );
  });

  it('refuses at plan time a host the workspace does not allow, sending nothing', async () => {
    const host = new FakeHost();
    host.endpoints.set('https://other.example.com/run', () => ({ status: 200 }));
    const ran = await run(
      [`call url=https://other.example.com/run token=routine body={"a": 1}`],
      host,
    );
    expect(ran.plan).toBeUndefined();
    expect(ran.errors.map(({ code }) => code)).toEqual(['E_RECIPE_CALL']);
    expect(ran.errors[0]?.message).toBe(
      "'call' may not send to other.example.com: add it to recipes.call.hosts in the " +
        "workspace's .tyto/project.json first.",
    );
    expect(ran.at).toEqual(['url=https://other.example.com/run']);
    expect(host.received).toEqual([]);
  });

  it('refuses an address that is not https, or carries a user, at url=', async () => {
    const host = new FakeHost();
    for (const url of [
      'http://hooks.example.com/run',
      'https://user:pass@hooks.example.com/run',
      'https://hooks.example.com/run#part',
    ]) {
      const ran = await run([`call url=${url} token=routine body={}`], host);
      expect(ran.errors.map(({ code }) => code)).toEqual(['E_RECIPE_CALL']);
      expect(ran.at).toEqual([`url=${url}`]);
    }
  });

  it('refuses from a folder that is not trusted, and a credential not stored', async () => {
    const restricted = new FakeHost();
    restricted.allowed = undefined;
    const outside = await run([CALL], restricted);
    expect(outside.errors[0]?.message).toContain('sends only from a trusted workspace');

    const ran = await run([`call url=${URL} token=missing body={}`], new FakeHost());
    expect(ran.errors[0]?.message).toBe(
      "'call' has no credential named 'missing' stored on this machine; store it first.",
    );
    expect(ran.at).toEqual(['token=missing']);
  });

  it('refuses a body past its ceiling, naming the row', async () => {
    const big = tasks(['title'], [['x'.repeat(CALL_BODY_LIMIT_BYTES)]]);
    const ran = await run(
      [`call url=${URL} token=routine body={"t": "{title|}"}`],
      new FakeHost(),
      {
        input: big,
      },
    );
    expect(ran.errors[0]?.message).toContain("for row 'T-0', past 16384");
  });

  it('never shows the token in a plan, a diagnostic or an outcome', async () => {
    const host = new FakeHost();
    host.endpoints.set(URL, () => ({ status: 401, body: `bad token ${TOKEN}` }));
    const ran = await run([CALL], host);
    const answer = await applied(ran);
    const unknown = await run([`call url=${URL} token=missing body={}`], host);
    const seen = JSON.stringify([ran.plan, ran.errors, answer, unknown.errors]);
    expect(host.received).toHaveLength(2);
    expect(seen).not.toContain(TOKEN);
  });

  it('fails a row on any status but 2xx, with the status and not the body', async () => {
    const host = new FakeHost();
    let calls = 0;
    host.endpoints.set(URL, () => {
      calls += 1;
      return calls === 1
        ? { status: 500, body: 'stack trace with secrets' }
        : { status: 302, location: 'https://evil.example.net/' };
    });
    const answer = await applied(await run([CALL], host));
    expect(answer.ok && answer.value.operations).toEqual([
      { rowKey: 'T-0', status: 'failed', reason: 'hooks.example.com answered HTTP 500' },
      { rowKey: 'T-1', status: 'failed', reason: 'hooks.example.com answered HTTP 302' },
    ]);
    // The redirect was not followed: only the allowed host was reached.
    expect(host.received.map(({ url }) => url)).toEqual([URL, URL]);
  });

  it('fails a row the host could not reach in time, and the others still go', async () => {
    const host = new FakeHost();
    let calls = 0;
    host.endpoints.set(URL, () => {
      calls += 1;
      return calls === 1 ? undefined : { status: 200 };
    });
    const answer = await applied(await run([CALL], host));
    expect(answer.ok && answer.value.operations).toEqual([
      {
        rowKey: 'T-0',
        status: 'failed',
        reason: "could not reach hooks.example.com: 'call' gave no answer within 30000 ms",
      },
      { rowKey: 'T-1', status: 'applied', appliedAt: NOW },
    ]);
  });

  it('plans where the host sends nothing, and refuses that Apply', async () => {
    const host = new FakeHost();
    host.sends = false;
    const ran = await run([CALL], host);
    expect(ran.plan?.target).toBe('requests to hooks.example.com (this host sends none)');
    const answer = await applied(ran);
    expect(answer.ok).toBe(false);
    expect(!answer.ok && answer.error[0]?.message).toBe(
      "Applying the plan of 'call' was refused: this host sends no requests.",
    );

    const none = await run([CALL], undefined);
    expect(none.plan?.count).toBe(2);
    const refused = await applied(none);
    expect(!refused.ok && refused.error[0]?.message).toContain('this host sends no requests');
  });

  it('refuses the whole Apply when the host left the list since the plan', async () => {
    const host = new FakeHost();
    host.endpoints.set(URL, () => ({ status: 200 }));
    const ran = await run([CALL], host);
    host.allowed = ['other.example.com'];
    const answer = await applied(ran);
    expect(!answer.ok && answer.error[0]?.message).toContain(
      'hooks.example.com is no longer in the workspace',
    );
    expect(host.received).toEqual([]);
  });

  it('refuses a plan no call answered, such as a copy', async () => {
    const host = new FakeHost();
    const ran = await run([CALL], host);
    if (ran.plan === undefined) throw new Error('a plan');
    const answer = await ran.verbs.get('call')?.apply?.({ ...ran.plan });
    expect(answer?.ok).toBe(false);
    expect(host.received).toEqual([]);
  });
});

describe('call, remembered (ADR 0193 decision 6)', () => {
  const DISPATCH = [
    'last dispatched',
    'where last_stored_at is empty',
    CALL,
    'remember dispatched columns=title',
  ];

  async function dispatch(host: FakeHost, state: ReturnType<typeof memoryState>) {
    const ran = await run(DISPATCH, host, { state });
    expect(ran.errors).toEqual([]);
    if (ran.plan === undefined) throw new Error('a plan');
    const answer = await applied(ran);
    if (!answer.ok) throw new Error('the Apply must run');
    for (const commit of stateToCommit(ran.remembers, answer.value)) {
      await state.write(commit.store, commit.puts, commit.deletes);
    }
    return { ran, operations: answer.value.operations };
  }

  it('plans 2 requests for 2 rows, then 0 on the next run', async () => {
    const host = new FakeHost();
    host.endpoints.set(URL, () => ({ status: 200 }));
    const state = memoryState();
    const first = await dispatch(host, state);
    expect(first.ran.plan?.count).toBe(2);
    const second = await dispatch(host, state);
    expect(second.ran.plan?.count).toBe(0);
    expect(host.received).toHaveLength(2);
  });

  it('plans again only the row whose request failed', async () => {
    const host = new FakeHost();
    host.endpoints.set(URL, (request) => ({
      status: request.body.includes('"T-1"') ? 503 : 200,
    }));
    const state = memoryState();
    await dispatch(host, state);
    expect([...(state.stores.get('dispatched')?.keys() ?? [])]).toEqual(['T-0']);
    host.endpoints.set(URL, () => ({ status: 200 }));
    const second = await dispatch(host, state);
    expect(second.ran.plan?.operations.map(({ rowKey }) => rowKey)).toEqual(['T-1']);
  });
});

describe('httpsHost', () => {
  it('answers the host of an https address in lower case, port aside', () => {
    expect(httpsHost('https://Hooks.Example.com:8443/a?b=c')).toEqual({
      ok: true,
      value: 'hooks.example.com',
      diagnostics: [],
    });
    expect(httpsHost('https://hooks.example.com:99999/').ok).toBe(false);
    expect(httpsHost('ftp://hooks.example.com/').ok).toBe(false);
  });
});
