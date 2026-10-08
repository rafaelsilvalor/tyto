import { spawn } from 'node:child_process';

import { appSwitches, killTree } from './run-as-node-probe.js';

/** How one isolated launch of an executable ended. */
export interface LaunchProbe {
  /** `exited` on its own, or `killed` by the deadline — what a booted app ends as. */
  readonly ended: 'exited' | 'killed';
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  /** The last of what it wrote to stderr, where Electron says why it refused to start. */
  readonly stderrTail: string;
}

export interface LaunchProbeOptions {
  readonly userData: string;
  readonly home: string;
  readonly deadlineMs: number;
}

/**
 * Start an executable as the app and say whether it was still up at the deadline (TYTO-241).
 *
 * The same shape `probeRunAsNode` gives TYTO-193, without the variable: a booted app never
 * exits on its own, so **still running at the deadline is what booting looks like**, and
 * exiting before it is a refusal. The switches that isolate it come first and nothing follows
 * a `--`, because Chromium stops reading switches there and the app would open the machine's
 * real data folder (ADR 0067). The whole process tree is killed at the deadline.
 */
export function probeLaunch(executable: string, options: LaunchProbeOptions): Promise<LaunchProbe> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    TYTO_HEADLESS: '1',
    TYTO_HOME: options.home,
  };
  delete environment['NODE_OPTIONS'];
  delete environment['ELECTRON_RUN_AS_NODE'];

  const child = spawn(executable, appSwitches(options.userData), {
    env: environment,
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: process.platform !== 'win32',
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-2_000);
  });

  return new Promise((resolve, reject) => {
    let killed = false;
    const deadline = setTimeout(() => {
      killed = true;
      killTree(child.pid);
    }, options.deadlineMs);

    child.once('error', (cause) => {
      clearTimeout(deadline);
      reject(cause);
    });
    child.once('close', (code, signal) => {
      clearTimeout(deadline);
      resolve({ ended: killed ? 'killed' : 'exited', code, signal, stderrTail: stderr.trim() });
    });
  });
}
