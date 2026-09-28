/* eslint-disable -- TYTO-186 throwaway measurement script, never merged. */
// TYTO-186 measurement. DO NOT MERGE.
// `node run-bundled.mjs <release dir>`: finds the Node binary where electron-builder put it
// in the unpacked app and runs probe.mjs with it, so every sandboxed child the probe starts
// is that bundled binary.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const [release] = process.argv.slice(2);
const probe = path.join(import.meta.dirname, 'probe.mjs');

function resourcesOf() {
  if (process.platform === 'win32') return path.join(release, 'win-unpacked', 'resources');
  if (process.platform === 'linux') return path.join(release, 'linux-unpacked', 'resources');
  const mac = readdirSync(release).find((name) => name.startsWith('mac'));
  return path.join(release, mac, 'Tyto.app', 'Contents', 'Resources');
}

const binary = path.join(resourcesOf(), 'node', process.platform === 'win32' ? 'node.exe' : 'node');
console.log(`bundled binary: ${binary} exists=${existsSync(binary)}`);
console.log(execFileSync(binary, [probe], { encoding: 'utf8', timeout: 120000 }));
