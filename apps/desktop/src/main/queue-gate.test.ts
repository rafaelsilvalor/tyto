import type { BriefSource, BriefTask } from '@tyto/io';
import { describe, expect, it } from 'vitest';

import { gateInbox } from './queue-gate.js';

/**
 * The gate's ordering, against a source whose every call waits until the test lets it go
 * (TYTO-239). No clock and no filesystem: each claim is about which call the inner source saw
 * start while which other one was still open, so the test decides every interleaving itself.
 */

interface Held {
  readonly kind: 'pull' | 'ack';
  readonly release: (failure?: Error) => void;
}

function heldSource() {
  const started: Held[] = [];
  const open = new Set<Held>();
  const overlaps: string[] = [];

  const hold = <T>(kind: 'pull' | 'ack', value: T): Promise<T> => {
    // An ack that starts while anything is open, or a listing that starts while an ack is
    // open, is the overlap the gate exists to prevent.
    const clash = kind === 'ack' ? open.size > 0 : [...open].some((call) => call.kind === 'ack');
    if (clash) overlaps.push(`${kind} started with ${open.size} open`);
    return new Promise<T>((resolve, reject) => {
      const call: Held = {
        kind,
        release: (failure) => {
          open.delete(call);
          if (failure === undefined) resolve(value);
          else reject(failure);
        },
      };
      open.add(call);
      started.push(call);
    });
  };

  const source: BriefSource = {
    pull: () => hold<readonly BriefTask[]>('pull', []),
    ack: () => hold<void>('ack', undefined),
  };
  return { source, started, overlaps };
}

/** Lets every pending reaction run, so a call the gate allows has reached the source. */
const settle = (): Promise<void> =>
  new Promise((done) => {
    setImmediate(done);
  });

describe('the queue inbox gate (TYTO-239)', () => {
  it('lets listings run together', async () => {
    const { source, started } = heldSource();
    const gate = gateInbox(source);

    const listings = [gate.pull(), gate.pull(), gate.pull()];
    await settle();

    expect(started.map((call) => call.kind)).toEqual(['pull', 'pull', 'pull']);
    for (const call of started) call.release();
    await Promise.all(listings);
  });

  it('holds an ack until the listings already running have finished', async () => {
    const { source, started, overlaps } = heldSource();
    const gate = gateInbox(source);

    const listing = gate.pull();
    await settle();
    const ack = gate.ack('tarefa-1');
    await settle();
    expect(started.map((call) => call.kind)).toEqual(['pull']);

    started[0]?.release();
    await listing;
    await settle();
    expect(started.map((call) => call.kind)).toEqual(['pull', 'ack']);

    started[1]?.release();
    await ack;
    expect(overlaps).toEqual([]);
  });

  it('starts a listing asked for during an ack only after the ack', async () => {
    const { source, started, overlaps } = heldSource();
    const gate = gateInbox(source);

    const ack = gate.ack('tarefa-1');
    await settle();
    const listing = gate.pull();
    await settle();
    expect(started.map((call) => call.kind)).toEqual(['ack']);

    started[0]?.release();
    await ack;
    await settle();
    expect(started.map((call) => call.kind)).toEqual(['ack', 'pull']);

    started[1]?.release();
    await listing;
    expect(overlaps).toEqual([]);
  });

  it('is not starved by listings that keep arriving while an ack waits', async () => {
    const { source, started } = heldSource();
    const gate = gateInbox(source);

    const first = gate.pull();
    await settle();
    const ack = gate.ack('tarefa-1');
    const later = gate.pull();
    await settle();
    // The later listing waits behind the ack rather than joining the running one.
    expect(started.map((call) => call.kind)).toEqual(['pull']);

    started[0]?.release();
    await first;
    await settle();
    expect(started.map((call) => call.kind)).toEqual(['pull', 'ack']);
    started[1]?.release();
    await ack;
    await settle();
    started[2]?.release();
    await later;
    expect(started.map((call) => call.kind)).toEqual(['pull', 'ack', 'pull']);
  });

  it('runs two acks one after the other', async () => {
    const { source, started, overlaps } = heldSource();
    const gate = gateInbox(source);

    const acks = [gate.ack('tarefa-1'), gate.ack('tarefa-2')];
    await settle();
    expect(started).toHaveLength(1);
    started[0]?.release();
    await settle();
    expect(started).toHaveLength(2);
    started[1]?.release();
    await Promise.all(acks);
    expect(overlaps).toEqual([]);
  });

  it('passes a failed ack on and opens the gate again', async () => {
    const { source, started } = heldSource();
    const gate = gateInbox(source);

    const ack = gate.ack('tarefa-1');
    const listing = gate.pull();
    await settle();
    started[0]?.release(
      Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }),
    );

    await expect(ack).rejects.toThrow(/EPERM/u);
    await settle();
    expect(started.map((call) => call.kind)).toEqual(['ack', 'pull']);
    started[1]?.release();
    await expect(listing).resolves.toEqual([]);
  });

  it('lets an ack through after a listing that failed', async () => {
    const { source, started } = heldSource();
    const gate = gateInbox(source);

    const listing = gate.pull();
    const ack = gate.ack('tarefa-1');
    await settle();
    started[0]?.release(new Error('ENOENT'));

    await expect(listing).rejects.toThrow(/ENOENT/u);
    await settle();
    expect(started.map((call) => call.kind)).toEqual(['pull', 'ack']);
    started[1]?.release();
    await expect(ack).resolves.toBeUndefined();
  });
});
