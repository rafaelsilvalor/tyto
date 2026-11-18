import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDeliveryChecks } from './delivery-checks.js';

/**
 * The Explorer's delivery checks (TYTO-757, ADR 0215) over a real folder: the same port and the
 * same check `deliveries` gives a recipe, keyed by each delivery folder's real path.
 */

let scratch: string;
let work: string;

beforeEach(async () => {
  scratch = await realpath(await mkdtemp(join(tmpdir(), 'tyto-delivery-checks-')));
  work = join(scratch, 'campanha');
  await mkdir(join(work, '.tyto'), { recursive: true });
  await writeFile(
    join(work, '.tyto', 'project.json'),
    JSON.stringify({ delivery: { parent: 'entregas', sizes: { feed: '1080x1350' } } }),
  );
  const record = JSON.stringify({
    version: 1,
    key: 'MCA-1',
    formats: [
      { format: 'feed', count: 1 },
      { format: 'story', count: 1 },
    ],
  });
  await mkdir(join(work, 'entregas', 'mca-1', 'editaveis'), { recursive: true });
  await writeFile(join(work, 'entregas', 'mca-1', 'editaveis', 'delivery.json'), record);
  await writeFile(join(work, 'entregas', 'mca-1', 'editaveis', 'arte.psd'), 'psd');
  await mkdir(join(work, 'entregas', 'rascunho'), { recursive: true });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

/** A PNG header that states `width` by `height`: all the check reads of it. */
function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  bytes.writeUInt32BE(0x89_50_4e_47, 0);
  bytes.writeUInt32BE(0x0d_0a_1a_0a, 4);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const checks = (trust: 'trusted' | 'restricted' = 'trusted') =>
  createDeliveryChecks({
    place: () => Promise.resolve({ folder: work, trust }),
    home: join(scratch, 'home'),
    formatSizes: () => Promise.resolve({ story: { w: 1080, h: 1920 }, feed: { w: 1, h: 1 } }),
  });

describe('createDeliveryChecks', () => {
  it('badges each delivery with a record, and says when a badge changed', async () => {
    const lent = checks();
    expect(await lent.refresh()).toBe(true);
    const folder = join(work, 'entregas', 'mca-1');
    expect(lent.badgeOf(folder)).toEqual({ check: 'in-progress', problems: [] });
    expect(lent.badgeOf(join(work, 'entregas', 'rascunho'))).toBeUndefined();
    expect(await lent.refresh()).toBe(false);

    await writeFile(join(folder, 'feed.png'), png(1080, 1080));
    await writeFile(join(folder, 'story.png'), png(1080, 1920));
    expect(await lent.refresh()).toBe(true);
    expect(lent.badgeOf(folder)).toEqual({
      check: 'incomplete',
      problems: [
        "'feed' has 0 of 1 at 1080×1350",
        "'feed.png' is 1080×1080, and the record owes feed 1080×1350, story 1080×1920",
      ],
    });

    await writeFile(join(folder, 'feed.png'), png(1080, 1350));
    expect(await lent.refresh()).toBe(true);
    expect(lent.badgeOf(folder)).toEqual({ check: 'ready', problems: [] });
  });

  it('badges nothing in a restricted folder, or with no folder open', async () => {
    const restricted = checks('restricted');
    expect(await restricted.refresh()).toBe(false);
    expect(restricted.badgeOf(join(work, 'entregas', 'mca-1'))).toBeUndefined();
    const none = createDeliveryChecks({
      place: () => Promise.resolve(undefined),
      home: join(scratch, 'home'),
      formatSizes: () => Promise.resolve({}),
    });
    expect(await none.refresh()).toBe(false);
  });

  it('caps the problems a badge carries at twenty', async () => {
    const folder = join(work, 'entregas', 'mca-1');
    const long = 'x'.repeat(150);
    for (let index = 0; index < 25; index += 1) {
      await writeFile(join(folder, `${long}-${String(index)}.png`), png(10, 10));
    }
    const lent = checks();
    await lent.refresh();
    const badge = lent.badgeOf(folder);
    expect(badge?.check).toBe('incomplete');
    expect(badge?.problems).toHaveLength(20);
  });
});
