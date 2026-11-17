import { describe, expect, it } from 'vitest';

import {
  type DeliveryFieldValue,
  type DeliveryRecord,
  type DeliveryRecordField,
  mergeDeliveryRecord,
  parseDeliveryFormats,
  readDeliveryRecord,
  writeDeliveryRecord,
} from './delivery-record.js';

/**
 * A delivery's record (TYTO-755, ADR 0210): the schema that reads it, the formats a row writes
 * as `feed:3,story:1`, and the three-way merge that keeps a person's edit.
 */

function incoming(
  values: Partial<Record<DeliveryRecordField, DeliveryFieldValue | undefined>>,
): Map<DeliveryRecordField, DeliveryFieldValue | undefined> {
  return new Map(Object.entries(values) as [DeliveryRecordField, DeliveryFieldValue][]);
}

function read(text: string): DeliveryRecord {
  const record = readDeliveryRecord(text);
  if (!record.ok) throw new Error(record.error);
  return record.value;
}

describe('the delivery record schema', () => {
  it('reads a record and keeps a key it does not know', () => {
    const record = read(
      JSON.stringify({ version: 1, key: 'T-1', due: '2026-11-20', reviewer: 'Ana' }),
    );
    expect(record.key).toBe('T-1');
    expect((record as Record<string, unknown>)['reviewer']).toBe('Ana');
    expect(writeDeliveryRecord(record)).toContain('"reviewer": "Ana"');
  });

  it('refuses a record without a key, of another version, or with a due date that is no date', () => {
    expect(readDeliveryRecord('{"version":1}').ok).toBe(false);
    expect(readDeliveryRecord('{"version":2,"key":"T-1"}').ok).toBe(false);
    const due = readDeliveryRecord('{"version":1,"key":"T-1","due":"amanhã"}');
    expect(due.ok ? '' : due.error).toMatch(/^is not a delivery record \(due: /u);
    expect(readDeliveryRecord('{not json')).toMatchObject({ ok: false, error: 'is not JSON' });
  });

  it('accepts a full ISO time with its offset as a due date', () => {
    expect(readDeliveryRecord('{"version":1,"key":"T","due":"2026-11-20T18:00:00-03:00"}').ok).toBe(
      true,
    );
  });
});

describe('parseDeliveryFormats', () => {
  it('reads formats and counts in order, one when the count is left out', () => {
    expect(parseDeliveryFormats('feed:3, story:1,carrossel')).toMatchObject({
      ok: true,
      value: [
        { format: 'feed', count: 3 },
        { format: 'story', count: 1 },
        { format: 'carrossel', count: 1 },
      ],
    });
    expect(parseDeliveryFormats('  ')).toMatchObject({ ok: true, value: [] });
  });

  it('refuses a count that is not a whole positive number, and a format named twice', () => {
    expect(parseDeliveryFormats('feed:0').ok).toBe(false);
    expect(parseDeliveryFormats('feed:1.5').ok).toBe(false);
    expect(parseDeliveryFormats('feed:x').ok).toBe(false);
    expect(parseDeliveryFormats('feed:1:2').ok).toBe(false);
    expect(parseDeliveryFormats('feed:1,feed:2')).toMatchObject({
      ok: false,
      error: "names the format 'feed' twice",
    });
  });
});

describe('mergeDeliveryRecord', () => {
  const first = incoming({
    key: 'T-1',
    due: '2026-11-20',
    link: 'https://tracker.example/T-1',
    ship: undefined,
  });

  it('creates a record with the base of what it wrote, an empty field left out', () => {
    const merged = mergeDeliveryRecord(undefined, first);
    expect(merged.created).toBe(true);
    expect(merged.changed).toBe(true);
    expect(merged.record).toEqual({
      version: 1,
      key: 'T-1',
      link: 'https://tracker.example/T-1',
      due: '2026-11-20',
      written: { key: 'T-1', link: 'https://tracker.example/T-1', due: '2026-11-20', ship: null },
    });
  });

  it('changes nothing when the same values come again', () => {
    const created = read(writeDeliveryRecord(mergeDeliveryRecord(undefined, first).record));
    const again = mergeDeliveryRecord(created, first);
    expect(again).toMatchObject({ changed: false, updated: [], kept: [], created: false });
  });

  it('carries a value changed at the source into a field nobody edited', () => {
    const created = read(writeDeliveryRecord(mergeDeliveryRecord(undefined, first).record));
    const later = mergeDeliveryRecord(
      created,
      incoming({ key: 'T-1', due: '2026-11-25', link: 'https://tracker.example/T-1' }),
    );
    expect(later.updated).toEqual(['due']);
    expect(later.record.due).toBe('2026-11-25');
    expect(later.record.written).toMatchObject({ due: '2026-11-25' });
  });

  it('keeps a field a person edited, and still updates the others', () => {
    const created = read(writeDeliveryRecord(mergeDeliveryRecord(undefined, first).record));
    const edited = read(writeDeliveryRecord({ ...created, due: '2026-11-22', state: 'doing' }));
    const later = mergeDeliveryRecord(
      edited,
      incoming({ key: 'T-1', due: '2026-11-25', link: 'https://tracker.example/T-1b' }),
    );
    expect(later.kept).toEqual(['due']);
    expect(later.updated).toEqual(['link']);
    expect(later.record.due).toBe('2026-11-22');
    expect(later.record.state).toBe('doing');
    expect(later.record.written).toMatchObject({ due: '2026-11-20' });
  });

  it('removes a field the source emptied, when nobody edited it', () => {
    const created = read(writeDeliveryRecord(mergeDeliveryRecord(undefined, first).record));
    const later = mergeDeliveryRecord(
      created,
      incoming({ key: 'T-1', due: undefined, link: 'https://tracker.example/T-1' }),
    );
    expect(later.updated).toEqual(['due']);
    expect('due' in later.record).toBe(false);
    expect(later.record.written).toMatchObject({ due: null });
  });

  it("treats a field filled by hand before the recipe mapped it as the person's", () => {
    const byHand = read('{"version":1,"key":"T-1","stem":"aula-1"}');
    const later = mergeDeliveryRecord(byHand, incoming({ key: 'T-1', stem: 'lesson-1' }));
    expect(later).toMatchObject({ changed: false, kept: ['stem'] });
  });

  it('compares formats by value, so the same counts are no change', () => {
    const formats = incoming({ key: 'T-1', formats: [{ format: 'feed', count: 3 }] });
    const created = read(writeDeliveryRecord(mergeDeliveryRecord(undefined, formats).record));
    expect(mergeDeliveryRecord(created, formats).changed).toBe(false);
  });
});
