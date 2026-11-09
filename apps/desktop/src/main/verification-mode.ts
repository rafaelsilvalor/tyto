/**
 * Verification mode (TYTO-651, ADR 0178): whether this window can be inspected over Chromium's
 * debugging port, and on which port.
 *
 * **Main detects the mode; it never opens it.** The only way in is Chromium's own
 * `--remote-debugging-port`, passed on the command line by whoever starts the app (the
 * launcher, an agent, the packaged suite). No fuse gates that switch, so a packaged Tyto has
 * always honoured it (ADR 0067); what this adds is that the window says so. An environment
 * variable was turned down: plugins and the integrated terminal inherit the environment, so a
 * Tyto started from that terminal would open a port nobody asked for.
 *
 * **Loopback only, measured.** On Electron 44 the port listens on `127.0.0.1` with or without
 * `--remote-debugging-address=0.0.0.0`; Chromium honours that switch in headless mode only. The
 * ADR keeps the netstat lines.
 *
 * **Shown only in a window a person sees.** Playwright's `_electron.launch` passes
 * `--remote-debugging-port=0` itself, so every desktop suite and the manual's screenshots run
 * with the port open; they also run with `TYTO_HEADLESS=1`, which never shows the window
 * (ADR 0036). There is nobody to warn there, so the window is told the mode is off.
 */

/** The switch Chromium reads, without its dashes, as `app.commandLine` names it. */
export const DEBUGGING_PORT_SWITCH_NAME = 'remote-debugging-port';

/** What the window shows: off, or on with the port when main could learn it. */
export type VerificationMode =
  { readonly on: false } | { readonly on: true; readonly port: number | undefined };

/** The part of `app.commandLine` this reads. */
export interface SwitchReader {
  hasSwitch(name: string): boolean;
  getSwitchValue(name: string): string;
}

/** A TCP port, or `undefined` for anything else (`0`, a word, an empty value). */
function portOf(text: string | undefined): number | undefined {
  if (text === undefined || !/^\d+$/u.test(text.trim())) return undefined;
  const port = Number(text.trim());
  return port > 0 && port <= 65_535 ? port : undefined;
}

/**
 * Whether verification mode is on, and its port.
 *
 * `--remote-debugging-port=0` asks Chromium to pick a free port, so the number is only in
 * `DevToolsActivePort`, which Chromium writes into the data folder once it listens:
 * `portFile` reads that file's text, or `undefined` when it is not there yet. Read at the
 * window's question rather than at start, because by then the port is open. `headless` is
 * `TYTO_HEADLESS=1`, a window nobody sees.
 */
export function verificationMode(
  switches: SwitchReader,
  portFile: () => string | undefined,
  headless = false,
): VerificationMode {
  if (headless || !switches.hasSwitch(DEBUGGING_PORT_SWITCH_NAME)) return { on: false };
  const asked = portOf(switches.getSwitchValue(DEBUGGING_PORT_SWITCH_NAME));
  if (asked !== undefined) return { on: true, port: asked };
  return { on: true, port: portOf(portFile()?.split('\n')[0]) };
}
