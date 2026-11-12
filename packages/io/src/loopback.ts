import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  CALLBACK_PATH,
  CALLBACK_TIMEOUT_MS,
  type CallbackListen,
  type CallbackOutcome,
  type CallbackPage,
  ENGLISH_CALLBACK_PAGE,
  LOOPBACK_HOST,
} from '@tyto/plugin-api';

/**
 * The redirect of a browser sign-in: a listener on this machine's loopback for one callback
 * (ADR 0174, decision 8; RFC 8252 section 7.3).
 *
 * **Bound to `127.0.0.1` and nothing else.** Every other interface would let another machine
 * on the network race the browser to the callback with a code of its own. Port 0 lets the
 * system pick a free port at that moment, so no port is reserved and none collides.
 *
 * It accepts one callback, answers it a static page and closes. The page never echoes the
 * query: the callback carries the code, and a page that printed it would hand it to whatever
 * reads the browser's history or a screenshot.
 *
 * The adapter behind `@tyto/plugin-api`'s `CallbackListen` port, which also holds the
 * outcome, page and option types; it moved here from the desktop's main so the CLI can
 * compose it too (TYTO-683).
 */

/** Escapes the five characters HTML gives meaning to; the words come from a catalogue. */
function escaped(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function page(
  response: ServerResponse,
  status: number,
  words: CallbackPage,
  message: string,
): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'close',
  });
  response.end(`<!doctype html>
<html lang="${escaped(words.lang)}">
<head><meta charset="utf-8"><title>Tyto</title></head>
<body style="font-family: system-ui, sans-serif; margin: 3rem;">
<p>${escaped(message)}</p>
<p>${escaped(words.close)}</p>
</body>
</html>
`);
}

function outcomeOf(request: IncomingMessage, state: string): CallbackOutcome {
  const query = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`).searchParams;
  // The state is checked before anything else is read, the error included: a callback from
  // another attempt says nothing about this one.
  if (query.get('state') !== state) return { kind: 'state-mismatch' };
  const error = query.get('error');
  if (error !== null) return { kind: 'error', error };
  const code = query.get('code');
  if (code === null || code === '') return { kind: 'error', error: 'no code in the callback' };
  return { kind: 'code', code };
}

/** Starts listening and answers once the port is bound. */
export const listenForCallback: CallbackListen = (options) => {
  const timeoutMs = options.timeoutMs ?? CALLBACK_TIMEOUT_MS;
  const words = options.page ?? ENGLISH_CALLBACK_PAGE;
  let settle: (outcome: CallbackOutcome) => void = () => undefined;
  let settled = false;
  const outcome = new Promise<CallbackOutcome>((resolve) => {
    settle = resolve;
  });

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`).pathname;
    if (settled || path !== CALLBACK_PATH || request.method !== 'GET') {
      // A favicon, a second callback or a stray probe: not this attempt's callback.
      page(response, 404, words, words.messages.notFound);
      return;
    }
    const answered = outcomeOf(request, options.state);
    page(response, answered.kind === 'code' ? 200 : 400, words, words.messages[answered.kind]);
    finish(answered);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (result: CallbackOutcome): void => {
    if (settled) return;
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    server.close();
    // A keep-alive browser connection would hold the port open after `close`.
    server.closeIdleConnections();
    settle(result);
  };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off('error', reject);
      const address = server.address() as AddressInfo;
      timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
      resolve({
        redirectUri: `http://${LOOPBACK_HOST}:${address.port}${CALLBACK_PATH}`,
        address,
        outcome,
        close: () => finish({ kind: 'closed' }),
      });
    });
  });
};
