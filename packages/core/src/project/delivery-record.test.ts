import { describe, expect, it } from 'vitest';

import {
  type DeliveryFieldName,
  type DeliveryFieldValue,
  type DeliveryInboundWinners,
  type DeliveryRecord,
  type DeliveryRecordField,
  type DeliveryWritableField,
  declaredFieldProblem,
  deliveryCopyText,
  deliveryFileBase,
  deliveryFormatsText,
  isDeclaredFieldMap,
  mergeDeliveryRecord,
  nearFixedField,
  parseDeliveryFormats,
  readDeliveryRecord,
  withDeliveryFileBase,
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

describe('mergeDeliveryRecord with declared inbound fields (ADR 0211)', () => {
  type Values = Partial<Record<DeliveryWritableField, DeliveryFieldValue | undefined>>;
  const bring = (values: Values) =>
    new Map(Object.entries(values) as [DeliveryWritableField, DeliveryFieldValue][]);
  const rowWins: DeliveryInboundWinners = new Map([['state', 'row']]);
  const recordWins: DeliveryInboundWinners = new Map([['state', 'record']]);

  /** A record the recipe wrote with `state: todo` from outside, then set on disk to `state`. */
  function synced(state: string): DeliveryRecord {
    const created = mergeDeliveryRecord(undefined, bring({ key: 'T-1', state: 'todo' }), rowWins);
    return read(writeDeliveryRecord({ ...created.record, state }));
  }

  it('lets the outside value in when only the outside changed', () => {
    const outside = bring({ key: 'T-1', state: 'doing' });
    const merged = mergeDeliveryRecord(synced('todo'), outside, rowWins);
    expect(merged).toMatchObject({ changed: true, updated: ['state'], conflicts: [] });
    expect(merged.record.state).toBe('doing');
    expect(merged.record.written).toMatchObject({ state: 'doing' });
  });

  it("keeps the record's value when only the record changed", () => {
    const outside = bring({ key: 'T-1', state: 'todo' });
    const merged = mergeDeliveryRecord(synced('done'), outside, rowWins);
    expect(merged).toMatchObject({ changed: false, kept: ['state'], conflicts: [] });
  });

  it('lets the row win a field both changed, and names what it overwrote', () => {
    const outside = bring({ key: 'T-1', state: 'review' });
    const merged = mergeDeliveryRecord(synced('doing'), outside, rowWins);
    expect(merged.conflicts).toEqual([{ field: 'state', winner: 'row', lost: 'doing' }]);
    expect(merged.record.state).toBe('review');
    expect(merged.record.written).toMatchObject({ state: 'review' });
  });

  it('lets the record win, and moves the base once so the next run sees no conflict', () => {
    const outside = bring({ key: 'T-1', state: 'review' });
    const merged = mergeDeliveryRecord(synced('doing'), outside, recordWins);
    expect(merged).toMatchObject({ changed: true, updated: [], based: ['state'] });
    expect(merged.conflicts).toEqual([{ field: 'state', winner: 'record', lost: 'review' }]);
    expect(merged.record.state).toBe('doing');
    expect(merged.record.written).toMatchObject({ state: 'review' });
    const again = mergeDeliveryRecord(
      read(writeDeliveryRecord(merged.record)),
      outside,
      recordWins,
    );
    expect(again).toMatchObject({ changed: false, conflicts: [], kept: ['state'] });
  });

  it('moves only the base when both sides already agree', () => {
    const outside = bring({ key: 'T-1', state: 'done' });
    const merged = mergeDeliveryRecord(synced('done'), outside, rowWins);
    expect(merged).toMatchObject({ changed: true, updated: [], based: ['state'], conflicts: [] });
    const again = mergeDeliveryRecord(read(writeDeliveryRecord(merged.record)), outside, rowWins);
    expect(again.changed).toBe(false);
  });

  it('control: without a declaration the same both-changed field is kept as an edit', () => {
    const merged = mergeDeliveryRecord(synced('doing'), bring({ key: 'T-1', state: 'review' }));
    expect(merged).toMatchObject({ changed: false, kept: ['state'], conflicts: [] });
  });

  it('writes formats as text that reads back as the same formats', () => {
    const formats = [
      { format: 'feed', count: 3 },
      { format: 'story', count: 1 },
    ];
    expect(deliveryFormatsText(formats)).toBe('feed:3,story:1');
    expect(parseDeliveryFormats(deliveryFormatsText(formats))).toMatchObject({
      ok: true,
      value: formats,
    });
  });
});

describe('mergeDeliveryRecord with kept fields (keep=, ADR 0211 note of 2026-11-17)', () => {
  const linked = incoming({ key: 'T-1', copy: 'https://docs.example/copy-1', due: '2026-11-20' });
  const created = () => read(writeDeliveryRecord(mergeDeliveryRecord(undefined, linked).record));

  it('leaves a kept field and its base alone when its cell comes back empty', () => {
    const before = created();
    const later = mergeDeliveryRecord(
      before,
      incoming({ key: 'T-1', copy: undefined, due: '2026-11-20' }),
      new Map(),
      new Set(['copy']),
    );
    expect(later).toMatchObject({ changed: false, held: ['copy'], updated: [], kept: [] });
    expect(later.record).toEqual(before);
  });

  it('holds the field while it still writes the others', () => {
    const later = mergeDeliveryRecord(
      created(),
      incoming({ key: 'T-1', copy: undefined, due: '2026-11-25' }),
      new Map(),
      new Set(['copy']),
    );
    expect(later).toMatchObject({ changed: true, held: ['copy'], updated: ['due'] });
    expect(later.record.copy).toBe('https://docs.example/copy-1');
    expect(later.record.written).toMatchObject({
      copy: 'https://docs.example/copy-1',
      due: '2026-11-25',
    });
  });

  it('reports a hand-edited value held by keep= as held, not edited', () => {
    const edited = read(writeDeliveryRecord({ ...created(), copy: 'https://docs.example/mine' }));
    const later = mergeDeliveryRecord(
      edited,
      incoming({ key: 'T-1', copy: undefined, due: '2026-11-20' }),
      new Map(),
      new Set(['copy']),
    );
    expect(later).toMatchObject({ changed: false, held: ['copy'], kept: [] });
  });

  it('clears the field as before when it is not kept', () => {
    const later = mergeDeliveryRecord(
      created(),
      incoming({ key: 'T-1', copy: undefined, due: '2026-11-20' }),
      new Map(),
      new Set(['due']),
    );
    expect(later).toMatchObject({ changed: true, held: [], updated: ['copy'] });
    expect('copy' in later.record).toBe(false);
    expect(later.record.written).toMatchObject({ copy: null });
  });

  it('merges a non-empty value of a kept field three ways as before', () => {
    const later = mergeDeliveryRecord(
      created(),
      incoming({ key: 'T-1', copy: 'https://docs.example/copy-2', due: '2026-11-20' }),
      new Map(),
      new Set(['copy']),
    );
    expect(later).toMatchObject({ changed: true, held: [], updated: ['copy'] });
    expect(later.record.copy).toBe('https://docs.example/copy-2');
  });

  it('holds nothing when the record has no value to keep', () => {
    const fresh = mergeDeliveryRecord(
      undefined,
      incoming({ key: 'T-1', copy: undefined }),
      new Map(),
      new Set(['copy']),
    );
    expect(fresh).toMatchObject({ created: true, held: [] });
    expect('copy' in fresh.record).toBe(false);
  });
});

describe('declared fields (ADR 0213)', () => {
  const bring = (values: Record<string, DeliveryFieldValue | undefined>) =>
    new Map(Object.entries(values) as [DeliveryFieldName, DeliveryFieldValue | undefined][]);
  const first = bring({ key: 'T-1', due: '2026-11-20', description: 'Cover, three slides' });
  const created = () => read(writeDeliveryRecord(mergeDeliveryRecord(undefined, first).record));

  it('creates a record with declared fields in their own map, their base in written.fields', () => {
    expect(mergeDeliveryRecord(undefined, first).record).toEqual({
      version: 1,
      key: 'T-1',
      due: '2026-11-20',
      fields: { description: 'Cover, three slides' },
      written: {
        key: 'T-1',
        due: '2026-11-20',
        fields: { description: 'Cover, three slides' },
      },
    });
  });

  it('changes nothing when the same declared values come again', () => {
    expect(mergeDeliveryRecord(created(), first)).toMatchObject({ changed: false, updated: [] });
  });

  it('carries a changed declared value, and keeps one a person edited', () => {
    const edited = read(
      writeDeliveryRecord({ ...created(), fields: { description: 'Cover only, by hand' } }),
    );
    const changed = bring({ key: 'T-1', due: '2026-11-20', description: 'Cover, four slides' });
    expect(mergeDeliveryRecord(created(), changed)).toMatchObject({
      updated: ['description'],
      record: { fields: { description: 'Cover, four slides' } },
    });
    expect(mergeDeliveryRecord(edited, changed)).toMatchObject({
      changed: false,
      kept: ['description'],
    });
  });

  it('removes the map when its last declared value is emptied, and keeps the base', () => {
    const emptied = mergeDeliveryRecord(
      created(),
      bring({ key: 'T-1', due: '2026-11-20', description: undefined }),
    );
    expect(emptied.record).toEqual({
      version: 1,
      key: 'T-1',
      due: '2026-11-20',
      written: { key: 'T-1', due: '2026-11-20', fields: { description: null } },
    });
  });

  it('holds a kept declared field, and lets an inbound one name its winner', () => {
    const held = mergeDeliveryRecord(
      created(),
      bring({ key: 'T-1', due: '2026-11-20', description: undefined }),
      new Map(),
      new Set(['description']),
    );
    expect(held).toMatchObject({ changed: false, held: ['description'] });

    const assigned = bring({ key: 'T-1', assignee: 'ana' });
    const winners: DeliveryInboundWinners = new Map([['assignee', 'record']]);
    const synced = read(
      writeDeliveryRecord({
        ...mergeDeliveryRecord(undefined, assigned, winners).record,
        fields: { assignee: 'bruno' },
      }),
    );
    const both = mergeDeliveryRecord(synced, bring({ key: 'T-1', assignee: 'carla' }), winners);
    expect(both.conflicts).toEqual([{ field: 'assignee', winner: 'record', lost: 'carla' }]);
    expect(both.record).toMatchObject({
      fields: { assignee: 'bruno' },
      written: { fields: { assignee: 'carla' } },
    });
  });

  it('reads a record written before ADR 0213, with no fields map, and merges it', () => {
    const old = read('{"version":1,"key":"T-1","due":"2026-11-20","written":{"key":"T-1"}}');
    const merged = mergeDeliveryRecord(old, bring({ key: 'T-1', description: 'New' }));
    expect(merged.record).toEqual({
      version: 1,
      key: 'T-1',
      due: '2026-11-20',
      fields: { description: 'New' },
      written: { key: 'T-1', fields: { description: 'New' } },
    });
  });

  it('reads a hand-made fields that is not a map of text, and keeps it untouched', () => {
    const odd = read('{"version":1,"key":"T-1","fields":["a","b"],"written":{"key":"T-1"}}');
    expect(isDeclaredFieldMap(odd.fields)).toBe(false);
    expect(isDeclaredFieldMap({ description: 'x' })).toBe(true);
    const merged = mergeDeliveryRecord(odd, bring({ key: 'T-2' }));
    expect(merged.record).toMatchObject({ key: 'T-2', fields: ['a', 'b'] });
  });

  it('refuses a name a delivery row already has, or that is not lowercase', () => {
    const taken = ['folder', 'path', 'key', 'link', 'formats', 'state', 'due'];
    // The check of a delivery's exports (ADR 0215) gives every row these too.
    for (const name of [...taken, 'check', 'check_problems', 'found_formats']) {
      expect(declaredFieldProblem(name)).toMatch(/column every delivery already has/u);
    }
    for (const name of ['Description', 'my field', '_x', 'tag.x', '']) {
      expect(declaredFieldProblem(name)).toMatch(/is not a field name/u);
    }
    expect(declaredFieldProblem('assignee')).toBeUndefined();
    expect(declaredFieldProblem('file-name_2')).toBeUndefined();
  });

  it('names the fixed field a declared name is two edits or fewer from', () => {
    expect(nearFixedField('lnik')).toBe('link');
    expect(nearFixedField('formts')).toBe('formats');
    expect(nearFixedField('shipp')).toBe('ship');
    expect(nearFixedField('description')).toBeUndefined();
    expect(nearFixedField('variante')).toBeUndefined();
    expect(nearFixedField('assignee')).toBeUndefined();
  });
});

describe('a delivery copy file (ADR 0217)', () => {
  it('puts the source on the first line, then the copy as it is, ending in one newline', () => {
    expect(deliveryCopyText('https://docs.example/d/1', '# Aula\n\n- um\n\n\n')).toBe(
      'Source: https://docs.example/d/1\n\n# Aula\n\n- um\n',
    );
    expect(deliveryCopyText(undefined, 'plain')).toBe('plain\n');
    expect(deliveryCopyText('  ', 'plain')).toBe('plain\n');
  });

  it('remembers a digest per file in written.files, and a merge keeps it', () => {
    const record: DeliveryRecord = { version: 1, key: 'T-1', written: { key: 'T-1' } };
    const based = withDeliveryFileBase(
      withDeliveryFileBase(record, 'editaveis/copy.md', 'a'),
      'editaveis/other.md',
      'b',
    );
    expect(based.written).toEqual({
      key: 'T-1',
      files: { 'editaveis/copy.md': 'a', 'editaveis/other.md': 'b' },
    });
    expect(record.written).toEqual({ key: 'T-1' });
    expect(deliveryFileBase(based, 'editaveis/copy.md')).toBe('a');
    expect(deliveryFileBase(record, 'editaveis/copy.md')).toBeUndefined();
    expect(deliveryFileBase({ ...record, written: { files: ['a'] } }, 'editaveis/copy.md')).toBe(
      undefined,
    );

    const merged = mergeDeliveryRecord(based, new Map([['due', '2026-11-20']]));
    expect(merged.changed).toBe(true);
    expect(deliveryFileBase(merged.record, 'editaveis/copy.md')).toBe('a');
  });
});
