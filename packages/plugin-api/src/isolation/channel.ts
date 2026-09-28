import type { GuestMessage, HelloMessage, HostMessage } from './protocol.js';

/**
 * The ports an isolated plugin's process is reached through (E11.2, ADR 0041).
 *
 * Declared here and implemented in the apps: a child process in `apps/cli`, and
 * `utilityProcess` in `apps/desktop`. Neither is a type this package may name (ADR 0010),
 * and neither needs to be — the whole protocol is "send a message, hear a message, hear
 * that the other end is gone", which is these few methods.
 *
 * Messages go out as the protocol's types and come in as `unknown`, because what arrives
 * is only what the other side claims it sent; `protocol.ts` is what reads it.
 */

/** The host's end of one plugin's process. */
export interface PluginChannel {
  send(message: HostMessage): void;
  onMessage(listener: (message: unknown) => void): void;
  /**
   * The process ended and {@link close} was not what ended it — a crash, as the host sees
   * it. Called at most once, with whatever the platform said about why.
   */
  onExit(listener: (reason: string) => void): void;
  /**
   * Whether this process should keep the app's own alive.
   *
   * `true` while the host waits for an answer and `false` otherwise, so that a CLI whose
   * render has finished exits without having to close every plugin first, and one that is
   * still waiting on a frame does not exit under it.
   */
  keepAlive(active: boolean): void;
  /** Ends the process. Not a crash: {@link onExit} is not called for it. */
  close(): Promise<void>;
}

/** The plugin's end: the same channel, seen from inside the process. */
export interface GuestChannel {
  send(message: GuestMessage | HelloMessage): void;
  onMessage(listener: (message: unknown) => void): void;
}

/** One installed plugin, as an app's launcher is asked to start it. */
export interface PluginProcessRequest {
  readonly name: string;
  /** The absolute path of the module whose `activate` the guest calls. */
  readonly entry: string;
  /**
   * The plugin's installed folder: the one place its process may read, where the app
   * confines it (ADR 0049).
   */
  readonly directory: string;
}

/** What each app implements: a process per plugin, and its end of the channel. */
export type PluginProcessLauncher = (request: PluginProcessRequest) => PluginChannel;
