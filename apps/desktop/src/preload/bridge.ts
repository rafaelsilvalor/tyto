import {
  type IpcChannelName,
  type IpcEventName,
  type TytoBridge,
  IPC_CHANNEL_NAMES,
  IpcContractError,
  isIpcEventName,
  parseIpc,
  parseIpcEvent,
} from '../../shared/ipc.js';

/**
 * The bridge object, built from the contract and given its transport.
 *
 * Separate from `index.ts` so it can be tested: `index.ts` imports `electron` for real and
 * is therefore unloadable outside a running Electron, while everything worth asserting here
 * — that the surface is exactly the contract, and that a bad request never reaches the wire
 * — is a property of this function and a fake `invoke`.
 *
 * Requests are validated **here as well as in main**, and the duplication is the point. Main
 * validates because it may not trust another process. This validates because it is the only
 * place that can refuse *before the message is sent*: the renderer gets a `TypeError` on its
 * own stack instead of a rejected promise from across a process boundary, and main is never
 * woken for a message that was never going to be accepted.
 *
 * An arriving push (ADR 0029) is validated here for the mirror of that argument, with the
 * roles swapped: a payload that does not fit is **main's** bug, and this is the only place
 * that can refuse it before a listener has already acted on it.
 */
export function createBridge(
  invoke: (channel: IpcChannelName, request: unknown) => Promise<unknown>,
  subscribe: (event: IpcEventName, listen: (payload: unknown) => void) => () => void,
): TytoBridge {
  const channels = Object.fromEntries(
    IPC_CHANNEL_NAMES.map((name) => [
      name,
      (request: unknown) => {
        // Throws synchronously, on purpose, and before `invoke`. The stack a developer sees
        // is the one that built the bad request, which is the whole value of this side.
        parseIpc(name, 'request', request);
        return invoke(name, request);
      },
    ]),
    // Cast here rather than on the object at the end: `Object.fromEntries` widens the keys to
    // `string`, and a cast over the *whole* bridge would also swallow a mistake in `on`.
  ) as Omit<TytoBridge, 'on'>;

  const on: TytoBridge['on'] = (event, listen) => {
    // Refused before anything is wired, and for a reason the request side does not have: a
    // misspelled event name would otherwise be a listener that simply never fires, which
    // reads as "main never sent it" and is the hardest kind of wiring bug to see.
    if (!isIpcEventName(event)) {
      throw new IpcContractError(event, 'event', 'no such event');
    }
    return subscribe(event, (payload: unknown) => {
      (listen as (payload: unknown) => void)(parseIpcEvent(event, payload));
    });
  };

  return { ...channels, on };
}
