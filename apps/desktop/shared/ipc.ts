import { z } from 'zod';

/**
 * The contract between the three processes, written once.
 *
 * `apps/desktop` is the only place in the repo where two runtimes have to agree about the
 * shape of a message, and the agreement is the thing that rots: main adds a field, the
 * renderer keeps sending the old shape, and nothing says so until a user sees a blank
 * panel. So neither side declares a channel. Both import this table — main to register a
 * handler and validate what arrives, the preload to validate what leaves and to build the
 * typed API the renderer sees — and the types the renderer programs against are derived
 * from the same schemas that do the validating (ADR 0001, `docs/architecture.md`).
 *
 * Zod and not hand-written types, because `contextIsolation: true` means every message is
 * structured-cloned across a process boundary: a type alone is erased at runtime and would
 * check the one side that was already correct. The schema is what survives the crossing.
 */

/** One channel: what may be asked, and what comes back. */
export interface IpcChannel<
  Request extends z.ZodType = z.ZodType,
  Response extends z.ZodType = z.ZodType,
> {
  readonly request: Request;
  readonly response: Response;
}

const channel = <Request extends z.ZodType, Response extends z.ZodType>(
  request: Request,
  response: Response,
): IpcChannel<Request, Response> => ({ request, response });

/**
 * An account name a credential is filed under.
 *
 * Constrained rather than left as a string: it becomes a key in a store the user cannot
 * see, and a blank or whitespace-only one would be a credential nobody can ever ask for
 * again.
 */
const accountName = z.string().trim().min(1).max(200);

/**
 * Every channel the app has, and the only place a channel name is written.
 *
 * Deliberately small. E9.1 opens a window and proves the wiring; the channels a brief, a
 * preview and a job need arrive with the cards that need them, and they arrive *here*
 * rather than beside the code that sends them.
 */
export const IPC_CHANNELS = {
  /**
   * What the renderer needs to render its shell, asked once on load.
   *
   * `locale` is the system's, which is what makes `pt-BR` a default rather than a hardcoded
   * choice: a machine set to English gets English without anybody changing a file.
   */
  'app:info': channel(
    z.object({}),
    z.object({
      version: z.string(),
      platform: z.string(),
      locale: z.string(),
      /**
       * The templates the plugin host actually holds, by name.
       *
       * Here rather than in a channel of its own because it is the answer to "did the
       * composition root wire anything": a built-in pack registered and never read would be
       * an extension point nobody could tell was broken. E9.2 needs the manifests
       * themselves and will ask for those; a name is what an empty window can say.
       */
      templates: z.array(z.string()),
    }),
  ),

  /**
   * Stores a secret through `safeStorage`, which is the OS keychain (ADR 0001).
   *
   * The renderer hands over the plaintext and never sees the ciphertext: encryption is
   * main's, because `safeStorage` is an Electron main-process API and a renderer with no
   * Node cannot reach it even if it wanted to.
   */
  'credentials:set': channel(
    z.object({ account: accountName, secret: z.string().min(1) }),
    z.object({ stored: z.boolean() }),
  ),

  /** Reads one back. `null` for an account nothing was ever stored under. */
  'credentials:get': channel(
    z.object({ account: accountName }),
    z.object({ secret: z.string().nullable() }),
  ),

  /** Forgets one. `false` when there was nothing to forget, which is not an error. */
  'credentials:delete': channel(
    z.object({ account: accountName }),
    z.object({ deleted: z.boolean() }),
  ),
} as const;

export type IpcChannels = typeof IPC_CHANNELS;
export type IpcChannelName = keyof IpcChannels;

export type IpcRequest<Name extends IpcChannelName> = z.infer<IpcChannels[Name]['request']>;
export type IpcResponse<Name extends IpcChannelName> = z.infer<IpcChannels[Name]['response']>;

/**
 * The API the preload puts on `window.tyto`.
 *
 * Derived from the table rather than written beside it, so a channel added above is a
 * method the renderer can call with no second declaration — and a channel removed is a
 * compile error at every call site rather than a rejected promise at runtime.
 */
export type TytoBridge = {
  readonly [Name in IpcChannelName]: (request: IpcRequest<Name>) => Promise<IpcResponse<Name>>;
};

export const IPC_CHANNEL_NAMES = Object.keys(IPC_CHANNELS) as readonly IpcChannelName[];

export function isIpcChannelName(name: string): name is IpcChannelName {
  return Object.prototype.hasOwnProperty.call(IPC_CHANNELS, name);
}

/**
 * The error a refused message raises, on whichever side refused it.
 *
 * A `TypeError` and not a `Diagnostic`: `docs/conventions.md` keeps `Result` for what a
 * *brief* can be wrong about, and reserves a throw for what a caller could have predicted
 * from its own arguments. A renderer sending the wrong shape down a channel it imported the
 * schema for is the second kind — nothing a user typed produced it.
 */
export class IpcContractError extends TypeError {
  constructor(
    readonly channel: string,
    readonly direction: 'request' | 'response',
    readonly issues: string,
  ) {
    super(`ipc ${channel}: ${direction} does not match the contract — ${issues}`);
    this.name = 'IpcContractError';
  }
}

const describe = (error: z.ZodError): string =>
  error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path === '' ? issue.message : `${path}: ${issue.message}`;
    })
    .join('; ');

/**
 * Checks one side of one message, and throws with the channel named when it does not fit.
 *
 * Both directions go through this, because the two sides fail for different reasons and a
 * reader needs to know which: a bad *request* is the renderer's bug, a bad *response* is
 * main's. The message says which without the reader opening a file.
 */
export function parseIpc<Name extends IpcChannelName, Direction extends 'request' | 'response'>(
  name: Name,
  direction: Direction,
  value: unknown,
): Direction extends 'request' ? IpcRequest<Name> : IpcResponse<Name> {
  const schema = IPC_CHANNELS[name][direction];
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new IpcContractError(name, direction, describe(parsed.error));
  return parsed.data as Direction extends 'request' ? IpcRequest<Name> : IpcResponse<Name>;
}
