/* eslint-disable -- TYTO-186 throwaway measurement script, never merged. */
// TYTO-186 measurement probe. DO NOT MERGE: this file exists only on a throwaway branch.
//
// `node probe.mjs` is the driver. It builds a temporary plugin folder and a sibling folder that
// holds a secret, copies itself into the plugin folder, and runs that copy as a sandboxed
// child in three ways: spawn, fork with IPC, and a worker whose execArgv asks for the
// permission model. Each child prints one line per capability it tried.
import { fork, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const role = process.argv[2];

async function tryAll(say) {
  const here = path.dirname(self);
  const outside = path.join(here, '..', 'outside', 'secret.txt');
  const bounded = (promise) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('no answer in 8 s')), 8000)),
    ]);
  async function attempt(name, run) {
    try {
      say(`${name}: ALLOWED ${(await bounded(Promise.resolve().then(run))) ?? ''}`);
    } catch (error) {
      say(`${name}: REFUSED ${error.code ?? ''} ${String(error.message).split('\n')[0]}`);
    }
  }
  const fs = await import('node:fs');
  await attempt('fs-read inside', () =>
    fs.readFileSync(path.join(here, 'inside.txt'), 'utf8').trim(),
  );
  await attempt('fs-read outside', () => fs.readFileSync(outside, 'utf8').trim());
  await attempt('fs-write inside', () => fs.writeFileSync(path.join(here, 'written.txt'), 'x'));
  await attempt('tcp socket', () =>
    import('node:net').then(
      ({ default: net }) =>
        new Promise((resolve, reject) => {
          const socket = net.connect(80, 'example.com');
          socket.on('connect', () => {
            socket.destroy();
            resolve('connected');
          });
          socket.on('error', reject);
        }),
    ),
  );
  await attempt('child_process', async () =>
    (await import('node:child_process'))
      .execFileSync(process.execPath, ['-e', 'process.stdout.write("1")'])
      .toString(),
  );
  await attempt('worker_threads', () =>
    import('node:worker_threads').then(
      ({ Worker }) =>
        new Promise((resolve, reject) => {
          try {
            const worker = new Worker('1', { eval: true });
            worker.on('exit', (code) => resolve(`exit ${code}`));
            worker.on('error', reject);
          } catch (error) {
            reject(error);
          }
        }),
    ),
  );
  await attempt('permission.has(fs.read, outside)', () =>
    String(process.permission?.has('fs.read', outside)),
  );
}

if (role === 'child') {
  await tryAll((line) => console.log(line));
} else if (role === 'ipc') {
  process.on('message', async () => {
    const lines = [];
    await tryAll((line) => lines.push(line));
    process.send(lines);
  });
} else if (role === 'worker') {
  await tryAll((line) => console.log(line));
} else {
  // The real path: on macOS the temporary folder is under /var, a link to /private/var, and a
  // grant on the linked path refuses the child its own entry (measured on the first run).
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'tyto-186-')));
  const plugin = path.join(root, 'plugin');
  mkdirSync(plugin);
  mkdirSync(path.join(root, 'outside'));
  writeFileSync(path.join(plugin, 'inside.txt'), 'inside');
  writeFileSync(path.join(root, 'outside', 'secret.txt'), 'secret');
  const copy = path.join(plugin, 'probe.mjs');
  copyFileSync(self, copy);
  const grant = ['--permission', `--allow-fs-read=${plugin}`];

  console.log(
    `node ${process.version} on ${process.platform}-${process.arch}, execPath ${process.execPath}`,
  );
  console.log(
    `allowedNodeEnvironmentFlags.has('--permission') = ${process.allowedNodeEnvironmentFlags.has('--permission')}`,
  );
  console.log(
    `allowedNodeEnvironmentFlags.has('--experimental-permission') = ${process.allowedNodeEnvironmentFlags.has('--experimental-permission')}`,
  );
  console.log(
    `allowedNodeEnvironmentFlags.has('--allow-net') = ${process.allowedNodeEnvironmentFlags.has('--allow-net')}`,
  );

  console.log(
    `\n== spawn: ${[path.basename(process.execPath), ...grant, 'probe.mjs', 'child'].join(' ')}`,
  );
  const spawned = spawnSync(process.execPath, [...grant, copy, 'child'], {
    encoding: 'utf8',
    timeout: 60000,
  });
  console.log(spawned.stdout.trim());
  if (spawned.stderr.trim() !== '')
    console.log(`[stderr] ${spawned.stderr.trim().split('\n').slice(0, 5).join('\n')}`);
  console.log(`status ${spawned.status}`);

  console.log(`\n== fork with IPC and serialization: 'advanced', same grant`);
  await new Promise((resolve) => {
    const child = fork(copy, ['ipc'], {
      execArgv: grant,
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child.on('message', (lines) => {
      console.log(lines.join('\n'));
      child.kill();
    });
    child.on('exit', (code, signal) => {
      console.log(`exit ${code ?? signal}`);
      resolve();
    });
    child.send('go');
  });

  console.log(`\n== worker with execArgv ${JSON.stringify(grant)} (parent unrestricted)`);
  const { Worker } = await import('node:worker_threads');
  await new Promise((resolve) => {
    try {
      const worker = new Worker(copy, { argv: ['worker'], execArgv: grant });
      worker.on('error', (error) => console.log(`worker error ${error.code} ${error.message}`));
      worker.on('exit', resolve);
    } catch (error) {
      console.log(`constructor threw ${error.code} ${error.message.split('\n')[0]}`);
      resolve();
    }
  });
}
