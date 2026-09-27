import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { type ForkUtility, type UtilityChild, utilityProcessLauncher } from './plugin-process.js';

/**
 * The `utilityProcess` adapter, against a child that records what it is asked (TYTO-48).
 *
 * The protocol is `@tyto/plugin-api`'s and is tested there; the real process is the e2e's.
 * What only this adapter decides is how Electron's events become the port's: which exit is
 * a crash, what its reason says, and that `close` is never reported as one.
 */

class FakeChild extends EventEmitter implements UtilityChild {
  readonly sent: unknown[] = [];
  killed = false;

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  kill(): boolean {
    this.killed = true;
    // Electron answers `kill` with an `exit` on the next turn.
    queueMicrotask(() => this.emit('exit', 0));
    return true;
  }
}

function launched() {
  const forks: { modulePath: string; args: string[]; serviceName: string }[] = [];
  const child = new FakeChild();
  const fork: ForkUtility = (modulePath, args, options) => {
    forks.push({ modulePath, args, serviceName: options.serviceName });
    return child;
  };
  const channel = utilityProcessLauncher(
    fork,
    '/app/out/main/plugin-guest.js',
  )({
    name: 'texto',
    entry: '/home/.tyto/plugins/texto/dist/index.js',
  });
  return { forks, child, channel };
}

describe('a plugin in a utility process', () => {
  it('forks the guest with the plugin module as its one argument', () => {
    const { forks } = launched();
    expect(forks).toEqual([
      {
        modulePath: '/app/out/main/plugin-guest.js',
        args: ['/home/.tyto/plugins/texto/dist/index.js'],
        serviceName: 'Tyto plugin texto',
      },
    ]);
  });

  it('carries messages both ways', () => {
    const { child, channel } = launched();
    const heard: unknown[] = [];
    channel.onMessage((message) => heard.push(message));

    channel.send({ protocol: 1, type: 'activate', plugin: 'texto', config: undefined });
    child.emit('message', { type: 'hello', protocol: 1 });

    expect(child.sent).toEqual([
      { protocol: 1, type: 'activate', plugin: 'texto', config: undefined },
    ]);
    expect(heard).toEqual([{ type: 'hello', protocol: 1 }]);
  });

  it('reports an exit nobody asked for as a crash, with the better reason when there is one', () => {
    const plain = launched();
    const failed = launched();
    const reasons: string[] = [];
    plain.channel.onExit((reason) => reasons.push(reason));
    failed.channel.onExit((reason) => reasons.push(reason));

    plain.child.emit('exit', 7);
    failed.child.emit('error', 'FatalError', 'plugin.js:1');
    failed.child.emit('exit', 1);

    expect(reasons).toEqual([
      'its process exited with code 7',
      'its process failed (FatalError at plugin.js:1)',
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
