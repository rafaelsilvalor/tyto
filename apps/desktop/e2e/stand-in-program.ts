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
 * - `mcp`: reads one line of JSON from stdin, the window's agent server a plugin got from
 *   `host.window.agentServer()` (ADR 0183), starts it as an ACP agent would, lists the tools and
 *   prints `SERVER`, `RELAY` and `TOOLS` lines.
 */

export const STAND_IN = 'tyto-echo';

const SCRIPT = `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/** What an ACP agent does with an mcpServers entry: start it, initialise, list the tools. */
function reachWindow(server) {
  process.stdout.write('SERVER ' + server.name + ' ' + server.env.map((v) => v.name).join(',') + '\\n');
  const env = { ...process.env };
  for (const variable of server.env) env[variable.name] = variable.value;
  const child = spawn(server.command, server.args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', (chunk) => process.stdout.write('RELAY ' + chunk.toString()));
  let buffered = '';
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString();
    for (let end; (end = buffered.indexOf('\\n')) >= 0; ) {
      const message = JSON.parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      if (message.id === 1) {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\\n');
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\\n');
      } else if (message.id === 2) {
        const names = message.result.tools.map((tool) => tool.name).sort();
        process.stdout.write('TOOLS ' + names.join(',') + '\\n');
        child.stdin.end();
        child.on('exit', () => process.exit(0));
      }
    }
  });
  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stand-in', version: '0' } },
  }) + '\\n');
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'mcp') {
  // The plugin sends the server on stdin, inside JSON, as ACP's session/new carries it.
  let line = '';
  process.stdin.on('data', (chunk) => {
    line += chunk.toString();
    const end = line.indexOf('\\n');
    if (end >= 0) reachWindow(JSON.parse(line.slice(0, end)));
  });
} else if (mode === 'hold') {
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
 * line, closes stdin and answers everything it heard; an `agent` exporter that hands
 * `tyto-echo mcp` the window's agent server and answers what it heard; a `hold` exporter that
 * starts `tyto-echo hold <pidFile>` and leaves it running. A refusal is answered as `REFUSED <code>`.
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
    id: 'janela', mime: 'text/plain', extension: 'agent', kinds: ['agent'], rasterized: false,
    exportFrame: async () => {
      try {
        const server = await host.window.agentServer();
        const program = await host.process.start(${JSON.stringify(STAND_IN)}, ['mcp']);
        let heard = '';
        program.onStdout((bytes) => { heard += new TextDecoder().decode(bytes); });
        await program.write(JSON.stringify(server) + '\\n');
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
