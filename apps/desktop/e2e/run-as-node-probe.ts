import { execFileSync, spawn } from 'node:child_process';

/** What one `ELECTRON_RUN_AS_NODE=1 <executable> -e "console.log(1)"` produced. */
export interface RunAsNodeProbe {
  /** Whether a line of stdout was exactly `1`, which only a Node evaluating `-e` prints. */
  readonly printedOne: boolean;
  /** `exited` on its own, or `killed` by the deadline — what a booted app ends as. */
  readonly ended: 'exited' | 'killed';
  readonly code: number | null;
  readonly stdoutBytes: number;
}

export interface RunAsNodeProbeOptions {
  readonly home: string;
  readonly deadlineMs: number;
  /**
   * Where the app keeps its data **if it boots as the app**, or `undefined` when the caller
   * expects a Node. See `appSwitches` for why this cannot simply always be passed.
   */
  readonly userData: string | undefined;
}

/**
 * The switches an executable that ignores `ELECTRON_RUN_AS_NODE` needs to boot isolated.
 *
 * **They cannot be passed to a Node, and they cannot be hidden from one.** Node reads options
 * after `-e <code>` too, so `--user-data-dir` makes it exit 9 (`bad option`) before it prints
 * anything — measured, and a probe that does that can never see a Node. Putting them behind
 * `--` satisfies Node and loses Chromium, which stops reading switches there: measured, the
 * packaged app booted into the real `%APPDATA%\Tyto\<version>`. So the caller decides from
 * the fuse wire which program it is about to start, and only an app gets the switches.
 */
export function appSwitches(userData: string): string[] {
  const switches = [`--user-data-dir=${userData}`];
  // The same switch Playwright adds on Linux: the unpacked folder's `chrome-sandbox` is not
  // setuid on a runner, and without it a booted app aborts instead of booting.
  if (process.platform === 'linux') switches.push('--no-sandbox');
  return switches;
}

/**
 * Ask an Electron executable to behave as Node, and say whether it did (TYTO-193, ADR 0067).
 *
 * **One function for both arms of the measurement**, the positive control and the packaged
 * app, so a capture that never saw stdout cannot pass for a fuse that held: the control has to
 * print `1` through this same code before the packaged answer means anything.
 *
 * With the RunAsNode fuse off the variable is ignored and the executable boots as the app, so
 * the probe isolates it like any e2e launch — its own `--user-data-dir` and `TYTO_HOME`, hidden
 * — and kills the **whole process tree** at the deadline: a GPU or utility child left behind
 * would hold the CI job open long after the test said it was done.
 */
export function probeRunAsNode(
  executable: string,
  options: RunAsNodeProbeOptions,
): Promise<RunAsNodeProbe> {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    TYTO_HEADLESS: '1',
    TYTO_HOME: options.home,
  };
  // Removed for the reason Playwright removes it: whatever the test runner put there is not
  // part of the question, and in the control it would be read by the Node being asked.
  delete environment['NODE_OPTIONS'];

  const args = ['-e', 'console.log(1)'];
  if (options.userData !== undefined) args.push(...appSwitches(options.userData));

  const child = spawn(executable, args, {
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Its own process group on POSIX, so one signal reaches every child it started.
    detached: process.platform !== 'win32',
  });

  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  // Drained so a chatty boot cannot fill the pipe and stall the process it is measuring.
  child.stderr.resume();

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
    child.once('close', (code) => {
      clearTimeout(deadline);
      resolve({
        printedOne: stdout.split(/\r?\n/u).some((line) => line.trim() === '1'),
        ended: killed ? 'killed' : 'exited',
        code,
        stdoutBytes: Buffer.byteLength(stdout),
      });
    });
  });
}

export function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Already gone between the deadline and the kill: the `close` event still resolves.
  }
}
