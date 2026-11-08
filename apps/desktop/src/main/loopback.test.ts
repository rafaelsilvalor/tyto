import { get } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CALLBACK_TIMEOUT_MS, type CallbackListener, listenForCallback } from './loopback.js';

/**
 * The redirect listener, on a real socket: binding, answering and closing are what is under
 * test, and a fake server would only prove the fake. Only the five-minute clock is faked.
 */

const open: CallbackListener[] = [];

async function listen(state = 'state-1'): Promise<CallbackListener> {
  const listener = await listenForCallback({ state });
  open.push(listener);
  return listener;
}

/** A browser's GET, through `node:http`: the desktop's code never reaches for `fetch`. */
const visit = (url: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    }).on('error', reject);
  });

afterEach(() => {
  for (const listener of open.splice(0)) listener.close();
  vi.useRealTimers();
});

describe('listenForCallback', () => {
  it('binds 127.0.0.1 only, on a port the system picked, and names it in the redirect', async () => {
    const listener = await listen();

    expect(listener.address.address).toBe('127.0.0.1');
    expect(listener.address.family).toBe('IPv4');
    expect(listener.address.port).toBeGreaterThan(0);
    expect(listener.redirectUri).toBe(`http://127.0.0.1:${listener.address.port}/callback`);
  });

  it('accepts one callback, answers a page that does not echo the code, and closes', async () => {
    const listener = await listen();

    const first = await visit(`${listener.redirectUri}?code=secret-code&state=state-1`);

    expect(first.status).toBe(200);
    expect(first.body).toContain('Signed in.');
    expect(first.body).not.toContain('secret-code');
    expect(await listener.outcome).toEqual({ kind: 'code', code: 'secret-code' });
    // Closed: a second callback finds nobody listening.
    await expect(visit(`${listener.redirectUri}?code=second&state=state-1`)).rejects.toThrow();
  });

  it('refuses a callback whose state is not its own, and ends the attempt', async () => {
    const listener = await listen();

    const answered = await visit(`${listener.redirectUri}?code=planted&state=other`);

    expect(answered.status).toBe(400);
    expect(await listener.outcome).toEqual({ kind: 'state-mismatch' });
  });

  it("reports the provider's error, after checking the state", async () => {
    const listener = await listen();

    await visit(`${listener.redirectUri}?error=access_denied&state=state-1`);

    expect(await listener.outcome).toEqual({ kind: 'error', error: 'access_denied' });
  });

  it('answers 404 elsewhere on the port without ending the attempt', async () => {
    const listener = await listen();
    const origin = new URL(listener.redirectUri).origin;

    expect((await visit(`${origin}/favicon.ico`)).status).toBe(404);

    await visit(`${listener.redirectUri}?code=c&state=state-1`);
    expect(await listener.outcome).toEqual({ kind: 'code', code: 'c' });
  });

  it('gives up after five minutes and stops listening', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const listener = await listen();
    let settled = false;
    void listener.outcome.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(CALLBACK_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(await listener.outcome).toEqual({ kind: 'timeout' });
    vi.useRealTimers();
    await expect(visit(`${listener.redirectUri}?code=late&state=state-1`)).rejects.toThrow();
  });

  it('settles as closed when the caller closes it first', async () => {
    const listener = await listen();

    listener.close();

    expect(await listener.outcome).toEqual({ kind: 'closed' });
  });
});
