import { type IncomingMessage, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

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
 */

/** The host the listener binds and the redirect names: an IP literal, never `localhost`. */
export const LOOPBACK_HOST = '127.0.0.1';

/** The path the redirect names; anything else on the port is a 404 and is not the callback. */
export const CALLBACK_PATH = '/callback';

/** How long a person has to finish in the browser before the attempt gives up. */
export const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export type CallbackOutcome =
  | { readonly kind: 'code'; readonly code: string }
  /** The provider sent the person back with `error` (they declined, or it refused). */
  | { readonly kind: 'error'; readonly error: string }
  /** A callback whose `state` is not this attempt's, which ends the attempt. */
  | { readonly kind: 'state-mismatch' }
  | { readonly kind: 'timeout' }
  /** Closed by the caller before anything came back. */
  | { readonly kind: 'closed' };

export interface CallbackListener {
  /** `http://127.0.0.1:<port>/callback`, the `redirect_uri` the authorize URL carries. */
  readonly redirectUri: string;
  /** The address the socket is bound to, so a test can read what was bound. */
  readonly address: AddressInfo;
  /** Settles once, with the first callback, the timeout or `close`. */
  readonly outcome: Promise<CallbackOutcome>;
  /** Stops listening; an outcome not yet settled is `closed`. */
  close(): void;
}

/**
 * The words of the page the browser lands on, in the window's language (ADR 0174, note of
 * 2026-11-08). Fixed text only: nothing from the query ever reaches it.
 */
export interface CallbackPage {
  /** The `lang` of the page, a BCP 47 tag. */
  readonly lang: string;
  /** One line per outcome, and `notFound` for anything on the port that is not the callback. */
  readonly messages: Readonly<Record<CallbackOutcome['kind'] | 'notFound', string>>;
  /** The line under it, saying the tab can be closed. */
  readonly close: string;
}

export interface ListenOptions {
  /** The `state` this attempt sent; a callback carrying another is refused. */
  readonly state: string;
  readonly timeoutMs?: number;
  /** The page's words; English when absent. */
  readonly page?: CallbackPage;
}

/** The English page, which a caller with no language at hand gets. */
export const ENGLISH_CALLBACK_PAGE: CallbackPage = {
  lang: 'en',
  messages: {
    code: 'Signed in.',
    error: 'The sign-in did not finish.',
    'state-mismatch': 'This sign-in was refused: it did not come from the attempt Tyto started.',
    timeout: 'The sign-in timed out.',
    closed: 'The sign-in was cancelled.',
    notFound: 'Nothing here.',
  },
  close: 'You can close this tab and go back to Tyto.',
};

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
export function listenForCallback(options: ListenOptions): Promise<CallbackListener> {
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
}
