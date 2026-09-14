import {
  type IpcChannelName,
  type TytoBridge,
  IPC_CHANNEL_NAMES,
  parseIpc,
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
 */
export function createBridge(
  invoke: (channel: IpcChannelName, request: unknown) => Promise<unknown>,
): TytoBridge {
  return Object.fromEntries(
    IPC_CHANNEL_NAMES.map((name) => [
      name,
      (request: unknown) => {
        // Throws synchronously, on purpose, and before `invoke`. The stack a developer sees
        // is the one that built the bad request, which is the whole value of this side.
        parseIpc(name, 'request', request);
        return invoke(name, request);
      },
    ]),
  ) as TytoBridge;
}
