import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A stand-in agent for Open an Agent Here (TYTO-567, ADR 0181), shared by the desktop and the
 * packaged suites. Named `claude`, so main gives it Claude Code's `--mcp-config`; a Node script
 * doing what an agent's host does with it: start the server it names, initialise, list the
 * tools, and print what it got (`RELAY` for the relay's stderr, `AGENT_TOOLS`, `AGENT_WINDOW`).
 *
 * On Windows a `.cmd`, as npm installs Claude Code there: the file `cmd.exe` reads again, which
 * the arguments must survive. It runs on the Node running the test.
 */
const FAKE_AGENT = `
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const at = process.argv.indexOf('--mcp-config');
const config = JSON.parse(readFileSync(process.argv[at + 1], 'utf8'));
const server = config.mcpServers.tyto;
const child = spawn(server.command, server.args, {
  env: { ...process.env, ...server.env },
  stdio: ['pipe', 'pipe', 'pipe'],
});
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
      process.stdout.write('AGENT_TOOLS ' + names.join(',') + '\\n');
      process.stdout.write('AGENT_WINDOW ' + process.env.TYTO_WINDOW + '\\n');
      child.stdin.end();
      child.on('exit', () => process.exit(0));
    }
  }
});
child.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-agent', version: '0' } },
}) + '\\n');
`;

/** Writes the agent into `folder` and returns the path `agentCommand` takes. */
export function writeFakeAgent(folder: string): string {
  mkdirSync(folder, { recursive: true });
  const script = join(folder, 'fake-agent.mjs');
  writeFileSync(script, FAKE_AGENT);
  if (process.platform === 'win32') {
    const path = join(folder, 'claude.cmd');
    writeFileSync(
      path,
      `@"${process.execPath}" "${script}" %*
`,
    );
    return path;
  }
  const path = join(folder, 'claude');
  writeFileSync(
    path,
    `#!/bin/sh
exec "${process.execPath}" "${script}" "$@"
`,
  );
  chmodSync(path, 0o755);
  return path;
}
