import { spawn } from 'node:child_process';

import { DEBUGGING_PORT_SWITCH } from './boot-signal.js';
import { type ProbeEnding, appSwitches, watchLaunch } from './run-as-node-probe.js';

/** How one isolated launch of an executable ended. */
export interface LaunchProbe {
  /** How it ended: see {@link ProbeEnding}. */
  readonly ended: ProbeEnding;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** The last of what it wrote to stderr, where Electron says why it refused to start. */
  readonly stderrTail: string;
  /** Whether stderr ever carried Node's `Debugger listening on` line (TYTO-249). */
  readonly debuggerListening: boolean;
}

export interface LaunchProbeOptions {
  readonly userData: string;
  readonly home: string;
  /** The upper bound for an app that never boots; one that does ends as soon as it has. */
  readonly deadlineMs: number;
  /**
   * More switches, before the isolating ones: `--inspect=0` for TYTO-249, and the app folder
   * for an Electron that is not the packaged one, after them.
   */
  readonly before?: readonly string[];
  readonly after?: readonly string[];
}

/**
 * Start an executable as the app and say whether it booted or refused (TYTO-241, TYTO-308).
 *
 * The same shape `probeRunAsNode` gives TYTO-193, without the variable: **a window with the
 * editor, reached over CDP, is what booting looks like**, and exiting before it is a refusal
 * (ADR 0103). The switches that isolate it come before any app folder, and nothing follows a
 * `--`, because Chromium stops reading switches there and the app would open the machine's real
 * data folder (ADR 0067). The whole process tree is killed once it has booted, or at the deadline.
 */
export function probeLaunch(executable: string, options: LaunchProbeOptions): Promise<LaunchProbe> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TYTO_HEADLESS: '1',
    TYTO_HOME: options.home,
  };
  delete environment['NODE_OPTIONS'];
  delete environment['ELECTRON_RUN_AS_NODE'];

  const child = spawn(
    executable,
    [
      ...(options.before ?? []),
      ...appSwitches(options.userData),
      DEBUGGING_PORT_SWITCH,
      ...(options.after ?? []),
    ],
    {
      env: environment,
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: process.platform !== 'win32',
    },
  );

  let stderr = '';
  // Read off the whole stream, not the tail: the line comes first and a chatty GPU on a
  // runner can push it out of 2,000 characters long before the probe ends.
  let debuggerListening = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2_000);
    if (stderr.includes('Debugger listening on')) debuggerListening = true;
  });

  return watchLaunch(child, {
    userData: options.userData,
    deadlineMs: options.deadlineMs,
    stderrTail: () => stderr,
  }).then(({ ended, code, signal }) => ({
    ended,
    code,
    signal,
    stderrTail: stderr.trim(),
    debuggerListening,
  }));
}
