import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PLUGIN_API_VERSION } from '@tyto/plugin-api';

/**
 * A stand-in for the program a plugin starts through `process:<name>` (TYTO-568, ADR 0182),
 * shared by the desktop and the packaged suites, and the plugin that starts it.
 *
 * `tyto-echo` is a Node script behind a `.cmd` on Windows, as npm installs an agent there, and
 * behind a shell script elsewhere; the suites put its folder, whose name has a space, first on
 * the app's `PATH`. Two modes:
 *
 * - `echo …`: prints `ARGS`, `SECRET`, `TOKEN`, `WINDOW` and `CWD` lines, then echoes stdin
 *   upper-cased until stdin closes.
 * - `hold <file>`: writes its process id into `<file>` and runs until it is ended.
 */

export const STAND_IN = 'tyto-echo';

const SCRIPT = `
import { writeFileSync } from 'node:fs';

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'hold') {
  writeFileSync(rest[0], String(process.pid));
  setInterval(() => undefined, 1000);
} else {
  process.stdout.write('ARGS ' + JSON.stringify(rest) + '\\n');
  process.stdout.write('SECRET ' + (process.env.ANTHROPIC_API_KEY ?? 'absent') + '\\n');
  process.stdout.write('TOKEN ' + (process.env.GH_TOKEN ?? 'absent') + '\\n');
  process.stdout.write('WINDOW ' + (process.env.TYTO_WINDOW ?? 'absent') + '\\n');
  process.stdout.write('CWD ' + process.cwd() + '\\n');
  process.stdin.on('data', (chunk) => process.stdout.write(chunk.toString().toUpperCase()));
}
`;

/** Writes `tyto-echo` into `folder` and returns the folder, for the front of `PATH`. */
export function writeStandInProgram(folder: string): string {
  mkdirSync(folder, { recursive: true });
  const script = join(folder, 'tyto-echo.mjs');
  writeFileSync(script, SCRIPT);
  if (process.platform === 'win32') {
    writeFileSync(join(folder, `${STAND_IN}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`);
  } else {
    const file = join(folder, STAND_IN);
    writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
    chmodSync(file, 0o755);
  }
  return folder;
}

/**
 * `programa`, installed in `home`: an `echo` exporter that starts `tyto-echo echo`, writes a
 * line, closes stdin and answers everything it heard; a `hold` exporter that starts
 * `tyto-echo hold <pidFile>` and leaves it running. A refusal is answered as `REFUSED <code>`.
 */
export function writeProgramPlugin(home: string, pidFile: string): void {
  const folder = join(home, 'plugins', 'programa');
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name: 'programa',
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions: [`process:${STAND_IN}`],
    }),
  );
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: 'programa', type: 'module' }));
  writeFileSync(
    join(folder, 'dist', 'index.js'),
    `const refused = (cause) => 'REFUSED ' + (cause && cause.code ? cause.code : String(cause));
const answer = (value) => ({ ok: true, value, diagnostics: [] });
export function activate(host) {
  host.registerExporter({
    id: 'programa', mime: 'text/plain', extension: 'echo', kinds: ['echo'], rasterized: false,
    exportFrame: async () => {
      try {
        const program = await host.process.start(${JSON.stringify(STAND_IN)}, ['echo', 'two words', '--acp']);
        let heard = '';
        program.onStdout((bytes) => { heard += new TextDecoder().decode(bytes); });
        await program.write('hello from the plugin\\n');
        await program.end();
        const exit = await program.exited;
        return answer(heard + 'EXIT ' + String(exit.code));
      } catch (cause) {
        return answer(refused(cause));
      }
    },
  });
  host.registerExporter({
    id: 'segura', mime: 'text/plain', extension: 'hold', kinds: ['hold'], rasterized: false,
    exportFrame: async () => {
      try {
        await host.process.start(${JSON.stringify(STAND_IN)}, ['hold', ${JSON.stringify(pidFile)}]);
        return answer('STARTED');
      } catch (cause) {
        return answer(refused(cause));
      }
    },
  });
}
`,
  );
}
