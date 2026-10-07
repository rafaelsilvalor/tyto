import { EventEmitter } from 'node:events';
import { posix, win32 } from 'node:path';

import { RPC_PROTOCOL_VERSION } from '@tyto/plugin-api';
import { describe, expect, it } from 'vitest';

import {
  type NodeChild,
  type SpawnNode,
  type SpawnOptions,
  bundledNodeLauncher,
  bundledNodePaths,
} from './plugin-process.js';

/**
 * The bundled-Node adapter, against a child that records what it is asked (TYTO-48,
 * TYTO-186).
 *
 * The protocol is `@tyto/plugin-api`'s and is tested there; the real process, under the real
 * permission model, is the e2e's and `test:package`'s. What only this adapter decides is what
 * the child is started with (which Node, which grants, which environment) and how its events
 * become the port's: which exit is a crash, what its reason says, and that `close` is never
 * reported as one.
 */

class FakeChild extends EventEmitter implements NodeChild {
  readonly sent: unknown[] = [];
  pid: number | undefined = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  killed = false;

  send(message: unknown): boolean {
    this.sent.push(message);
    return true;
  }

  kill(): boolean {
    this.killed = true;
    // Node answers `kill` with an `exit` on a later turn.
    queueMicrotask(() => this.emit('exit', null, 'SIGTERM'));
    return true;
  }
}

function launched() {
  const spawns: { command: string; args: string[]; options: SpawnOptions }[] = [];
  const child = new FakeChild();
  const spawn: SpawnNode = (command, args, options) => {
    spawns.push({ command, args, options });
    return child;
  };
  const channel = bundledNodeLauncher({
    spawn,
    // A link resolved, as `realpathSync` would: every granted path must be the real one.
    realpath: (path) => path.replace('/linked/', '/real/'),
    node: '/app/resources/node/node',
    guest: '/app/resources/app.asar.unpacked/out/guest/plugin-guest.js',
    canary: '/app/resources/app.asar',
  })({
    name: 'texto',
    entry: '/home/linked/.tyto/plugins/texto/dist/index.js',
    directory: '/home/linked/.tyto/plugins/texto',
  });
  return { spawns, child, channel };
}

describe('a plugin on the bundled Node', () => {
  it('starts the bootstrap on that Node, granted its folder and itself as real paths', () => {
    // The command is the bundled Node and the fourth slot is `ipc`: that pair is what `fork`
    // used to build, and Electron refuses `fork` once the RunAsNode fuse is off (TYTO-193).
    // Node's options come before the bootstrap, where `fork` put its `execArgv`; after it they
    // would be the plugin's `process.argv`, and the permission model would never switch on.
    const { spawns } = launched();
    expect(spawns).toEqual([
      {
        command: '/app/resources/node/node',
        args: [
          '--permission',
          '--allow-fs-read=/home/real/.tyto/plugins/texto',
          '--allow-fs-read=/app/resources/app.asar.unpacked/out/guest/plugin-guest.js',
          '/app/resources/app.asar.unpacked/out/guest/plugin-guest.js',
          '/home/real/.tyto/plugins/texto/dist/index.js',
          '/app/resources/app.asar',
        ],
        options: {
          env: {},
          serialization: 'json',
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        },
      },
    ]);
  });

  it("carries messages both ways, and keeps the bootstrap's last word for the crash", () => {
    const { child, channel } = launched();
    const heard: unknown[] = [];
    const reasons: string[] = [];
    channel.onMessage((message) => heard.push(message));
    channel.onExit((reason) => reasons.push(reason));

    channel.send({
      protocol: RPC_PROTOCOL_VERSION,
      type: 'activate',
      plugin: 'texto',
      config: undefined,
    });
    child.emit('message', { type: 'hello', protocol: RPC_PROTOCOL_VERSION });
    child.emit('message', { fatal: 'the ink ran out' });
    child.emit('exit', 1, null);

    // `config` survives JSON as a marker; a dropped key is what the guest's schema refused.
    expect(child.sent).toEqual([
      {
        protocol: RPC_PROTOCOL_VERSION,
        type: 'activate',
        plugin: 'texto',
        config: { $tytoUndefined: true },
      },
    ]);
    expect(heard).toEqual([{ type: 'hello', protocol: RPC_PROTOCOL_VERSION }]);
    expect(reasons).toEqual(['the ink ran out']);
  });

  it('carries bytes and undefined across its JSON channel, and rebuilds them on arrival', () => {
    const { child, channel } = launched();
    const heard: unknown[] = [];
    channel.onMessage((message) => heard.push(message));

    const body = new Uint8Array([0, 1, 254, 255]);
    channel.send({
      protocol: RPC_PROTOCOL_VERSION,
      type: 'response',
      id: 1,
      ok: true,
      value: { body, config: undefined },
    });
    child.emit('message', JSON.parse(JSON.stringify(child.sent[0])));

    expect(child.sent).toEqual([
      {
        protocol: RPC_PROTOCOL_VERSION,
        type: 'response',
        id: 1,
        ok: true,
        value: { body: { $tytoBytes: 'AAH+/w==' }, config: { $tytoUndefined: true } },
      },
    ]);
    expect(heard).toEqual([
      {
        protocol: RPC_PROTOCOL_VERSION,
        type: 'response',
        id: 1,
        ok: true,
        value: { body, config: undefined },
      },
    ]);
  });

  it('reports an exit nobody asked for as a crash, and a Node that never started as one too', () => {
    const plain = launched();
    const missing = launched();
    const reasons: string[] = [];
    plain.channel.onExit((reason) => reasons.push(reason));
    missing.channel.onExit((reason) => reasons.push(reason));

    plain.child.emit('exit', 7, null);
    missing.child.pid = undefined;
    missing.child.emit('error', new Error('spawn /app/resources/node/node ENOENT'));

    expect(reasons).toEqual([
      'its process exited with code 7',
      'its process could not start: spawn /app/resources/node/node ENOENT',
    ]);
  });

  it('is not a crash when the host closes it, and waits for the exit', async () => {
    const { child, channel } = launched();
    const reasons: string[] = [];
    channel.onExit((reason) => reasons.push(reason));

    await channel.close();

    expect(child.killed).toBe(true);
    expect(reasons).toEqual([]);
  });
});

describe('where the bundled Node is', () => {
  it('is an extra resource beside the asar in a package, with the bootstrap unpacked', () => {
    expect(
      bundledNodePaths({
        packaged: true,
        mainDirectory: 'C:\\Tyto\\resources\\app.asar\\out\\main',
        mainFile: 'C:\\Tyto\\resources\\app.asar\\out\\main\\index.js',
        resourcesPath: 'C:\\Tyto\\resources',
        platform: 'win32',
        join: win32.join,
      }),
    ).toEqual({
      node: 'C:\\Tyto\\resources\\node\\node.exe',
      guest: 'C:\\Tyto\\resources\\app.asar.unpacked\\out\\guest\\plugin-guest.js',
      canary: 'C:\\Tyto\\resources\\app.asar',
    });
  });

  it("is under out/ in development, where main's own bundle is the canary", () => {
    expect(
      bundledNodePaths({
        packaged: false,
        mainDirectory: '/repo/apps/desktop/out/main',
        mainFile: '/repo/apps/desktop/out/main/index.js',
        resourcesPath: '/electron/resources',
        platform: 'linux',
        join: posix.join,
      }),
    ).toEqual({
      node: '/repo/apps/desktop/out/node/node',
      guest: '/repo/apps/desktop/out/guest/plugin-guest.js',
      canary: '/repo/apps/desktop/out/main/index.js',
    });
  });
});
