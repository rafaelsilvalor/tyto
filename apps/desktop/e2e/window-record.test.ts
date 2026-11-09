import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { seenLine, windowRecordFor } from './window-record.js';

/**
 * Which agent-endpoint record is the launched window's (TYTO-656): the failure on the
 * `desktop-v0.17.0` tag, in miniature — an orphan left by a killed launch that sorts first, and
 * the live window's own record after it.
 */

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'tyto-window-record-'));
});

afterEach(() => {
  rmSync(folder, { recursive: true, force: true });
});

const DEAD = 999_999_991;

describe('windowRecordFor', () => {
  it("takes the window's own record over an orphan that sorts first, and says what it saw", () => {
    // `1…` sorts before this process's pid only if that pid starts with a higher digit; the
    // orphan is named `0…` so it sorts first whatever the pid is.
    writeFileSync(join(folder, '0999999991.json'), JSON.stringify({ pid: DEAD, endpoint: 'gone' }));
    writeFileSync(
      join(folder, `${String(process.pid)}.json`),
      JSON.stringify({ pid: process.pid, endpoint: 'live' }),
    );

    const found = windowRecordFor<{ pid: number; endpoint: string }>(folder, process.pid);
    expect(found.record?.endpoint).toBe('live');
    expect(found.seen.map((entry) => entry.name)[0]).toBe('0999999991.json');
    expect(seenLine(found.seen)).toBe(
      `0999999991.json pid ${String(DEAD)} dead, ${String(process.pid)}.json pid ${String(process.pid)} alive`,
    );
  });

  it('answers no record while the window has not written its own, and none for a missing folder', () => {
    writeFileSync(join(folder, '0999999991.json'), JSON.stringify({ pid: DEAD }));
    expect(windowRecordFor(folder, process.pid).record).toBeUndefined();
    expect(windowRecordFor(join(folder, 'nope'), process.pid)).toEqual({
      record: undefined,
      seen: [],
    });
    expect(seenLine([])).toBe('none');
  });
});
