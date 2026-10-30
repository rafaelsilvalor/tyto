import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { builtInDelivery } from '@tyto/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NO_FOLDER, createDeliveryService } from './delivery.js';

/**
 * "Delivery: New…" in main (TYTO-489, ADR 0157 §5): the window's name checked again here, and
 * the delivery planned and written in the open folder, never anywhere a request names.
 */

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'tyto-desktop-delivery-'));
});

afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

const service = () =>
  createDeliveryService({ layout: () => ({ root: folder, delivery: builtInDelivery(folder) }) });

describe('the delivery service', () => {
  it('makes the delivery in the open folder with the text it was sent', async () => {
    const made = await service().create('mca-1', '---\ntemplate: promo\n---\n');
    expect(made).toEqual({ ok: true, brief: join(folder, 'mca-1', 'editaveis', 'mca-1.brief') });
    expect(await readdir(join(folder, 'mca-1'))).toEqual(['assets', 'editaveis']);
    expect(await readFile(join(folder, 'mca-1', 'editaveis', 'mca-1.brief'), 'utf8')).toBe(
      '---\ntemplate: promo\n---\n',
    );
  });

  it('checks the name again, refusing one shaped like a path, and writes nothing', async () => {
    for (const name of ['../fora', 'a/b', 'C:\\x', '']) {
      const made = await service().create(name, '');
      expect(made).toMatchObject({ ok: false, code: 'W_DELIVERY_NAME_INVALID' });
    }
    expect(await readdir(folder)).toEqual([]);
  });

  it('refuses a brief that is already there', async () => {
    await service().create('mca-1', 'first');
    const again = await service().create('mca-1', 'second');
    expect(again).toMatchObject({ ok: false, code: 'E_DELIVERY_BRIEF_EXISTS' });
    // Relative to the folder, for the status bar's one line.
    expect(!again.ok && again.message).toContain(`'${join('mca-1', 'editaveis', 'mca-1.brief')}'`);
    expect(await readFile(join(folder, 'mca-1', 'editaveis', 'mca-1.brief'), 'utf8')).toBe('first');
  });

  it('makes nothing with no folder open', async () => {
    const closed = createDeliveryService({ layout: () => undefined });
    expect(await closed.create('mca-1', '')).toEqual({ ok: false, code: NO_FOLDER, message: '' });
  });
});

/** TYTO-490, ADR 0157 §6: which delivery a brief is in, read with no disk. */
describe('the delivery a brief belongs to', () => {
  it('answers its folders, and png when no sheet names the types', () => {
    const found = service().of(join(folder, 'mca-1', 'editaveis', 'mca-1.brief'));

    expect(found).toEqual({
      name: 'mca-1',
      folder: join(folder, 'mca-1'),
      exports: join(folder, 'mca-1'),
      report: join(folder, 'mca-1', 'editaveis'),
      types: ['png'],
    });
  });

  it('carries the formats and types the layout names', () => {
    const named = createDeliveryService({
      layout: () => ({
        root: folder,
        delivery: { ...builtInDelivery(folder), formats: ['story'], types: ['svg'] },
      }),
    });
    expect(named.of(join(folder, 'mca-1', 'editaveis', 'x.brief'))).toMatchObject({
      formats: ['story'],
      types: ['svg'],
    });
  });

  it('answers nothing for a brief in no delivery, or with no folder open', () => {
    expect(service().of(join(folder, 'solto.brief'))).toBeUndefined();
    const closed = createDeliveryService({ layout: () => undefined });
    expect(closed.of(join(folder, 'mca-1', 'editaveis', 'mca-1.brief'))).toBeUndefined();
  });

  it('says why, with paths relative to the open folder', () => {
    expect(service().notIn(join(folder, 'solto.brief'))).toEqual({
      code: 'E_BRIEF_NOT_IN_DELIVERY',
      message:
        "'solto.brief' is in no delivery: a delivery's brief is kept in its 'editaveis' folder, inside a folder in '.'. Make one with tyto delivery new, or export with --out.",
    });
  });
});
