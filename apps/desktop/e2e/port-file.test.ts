import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readPortFile } from './port-file.js';

const failingWith = (code: string) => (): string => {
  throw Object.assign(new Error(`${code}: simulated`), { code });
};

describe('reading DevToolsActivePort', () => {
  const folder = mkdtempSync(join(tmpdir(), 'tyto-port-file-'));

  it('waits while the file does not exist', () => {
    expect(readPortFile(join(folder, 'absent'))).toBeUndefined();
  });

  it('waits while only the port is written', () => {
    const file = join(folder, 'half');
    writeFileSync(file, '9222');
    expect(readPortFile(file)).toBeUndefined();
  });

  it('returns the port once both lines are there', () => {
    const file = join(folder, 'whole');
    writeFileSync(file, '9222\n/devtools/browser/abc');
    expect(readPortFile(file)?.[0]).toBe('9222');
  });

  it('waits while Windows reports the file busy (TYTO-95)', () => {
    // The release gate's Windows leg died at `EBUSY: resource busy or locked, open
    // '…\guard-data\DevToolsActivePort'`: the read landed while Chromium held the file.
    expect(readPortFile('DevToolsActivePort', failingWith('EBUSY'))).toBeUndefined();
  });

  it('still fails on an error that is not about timing', () => {
    expect(() => readPortFile('DevToolsActivePort', failingWith('EACCES'))).toThrow(/EACCES/);
  });
});
