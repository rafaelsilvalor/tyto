// PROBE TYTO-497 — never merged. Spawns the platform shell through node-pty in the packaged
// app, types a command whose answer (42) never appears in the typed text, and writes what came
// back to the file `TYTO_PTY_PROBE` names. Then quits.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

import { app } from 'electron';
import type * as NodePty from 'node-pty';

type ProbeResult = {
  loaded: boolean;
  marker: boolean;
  shell: string;
  output: string;
  error?: string;
};

export function runPtyProbeIfAsked(): boolean {
  const target = process.env.TYTO_PTY_PROBE;
  if (target === undefined || target === '') return false;
  const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
  const command =
    process.platform === 'win32'
      ? 'Write-Output ("TYTO_PTY_" + (40+2)); exit\r'
      : 'echo TYTO_PTY_$((40+2)); exit\r';
  const finish = (result: ProbeResult): void => {
    writeFileSync(target, JSON.stringify(result, null, 2));
    app.exit(0);
  };
  let output = '';
  try {
    const pty = createRequire(import.meta.url)('node-pty') as typeof NodePty;
    const child = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: app.getPath('home'),
      env: process.env as Record<string, string>,
    });
    child.onData((data) => {
      output += data;
    });
    child.onExit(() =>
      finish({ loaded: true, marker: output.includes('TYTO_PTY_42'), shell, output }),
    );
    setTimeout(() => child.write(command), 1500);
    setTimeout(
      () =>
        finish({
          loaded: true,
          marker: output.includes('TYTO_PTY_42'),
          shell,
          output,
          error: 'timeout',
        }),
      20000,
    );
  } catch (reason) {
    finish({ loaded: false, marker: false, shell, output, error: String(reason) });
  }
  return true;
}
