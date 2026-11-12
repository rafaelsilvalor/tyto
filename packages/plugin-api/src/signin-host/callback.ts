/**
 * The redirect of a browser sign-in, as a port (ADR 0174, decision 8; RFC 8252 section 7.3):
 * what the sign-in service asks of a loopback listener and what one answers. The listener
 * itself opens a socket, so it is an adapter, `listenForCallback` in `@tyto/io`; each host
 * composes it (TYTO-683).
 */

/** Where the listener's socket is bound; Node's `AddressInfo` has this shape. */
export interface CallbackAddress {
  readonly address: string;
  readonly family: string;
  readonly port: number;
}

/** Starts a listener for one callback; answers once the port is bound. */
export type CallbackListen = (options: ListenOptions) => Promise<CallbackListener>;

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
  readonly address: CallbackAddress;
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
