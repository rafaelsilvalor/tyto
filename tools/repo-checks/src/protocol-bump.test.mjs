import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  breakingBumpFor,
  PROTOCOL_FILE,
  protocolBumpVerdict,
  protocolVersionOf,
} from './protocol-bump.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const changeset = (bump) => ({ bumps: { '@tyto/plugin-api': bump } });

describe('protocolVersionOf', () => {
  it('reads the number out of the real protocol file', () => {
    const source = readFileSync(`${repoRoot}${PROTOCOL_FILE}`, 'utf8');
    expect(protocolVersionOf(source)).toBeGreaterThanOrEqual(8);
  });

  it('answers nothing for a file that no longer declares it', () => {
    expect(protocolVersionOf('export const OTHER = 3;')).toBeUndefined();
    expect(protocolVersionOf(undefined)).toBeUndefined();
  });
});

describe('breakingBumpFor', () => {
  it('is a minor on 0.x, where a caret range stops at the minor, and a major from 1.0', () => {
    expect(breakingBumpFor('0.4.1')).toBe('minor');
    expect(breakingBumpFor('1.2.0')).toBe('major');
  });
});

describe('protocolBumpVerdict', () => {
  const moved = { before: 8, after: 9, version: '0.4.1' };

  it('passes a branch that leaves the protocol alone, whatever it releases', () => {
    expect(
      protocolBumpVerdict({ before: 8, after: 8, version: '0.4.1', addedChangesets: [] }).ok,
    ).toBe(true);
  });

  it('fails a protocol change with no changeset for the package', () => {
    const verdict = protocolBumpVerdict({ ...moved, addedChangesets: [] });
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain("'@tyto/plugin-api': minor");
  });

  it('fails a protocol change released as a patch, which a ^0.4.1 range would install', () => {
    expect(protocolBumpVerdict({ ...moved, addedChangesets: [changeset('patch')] }).ok).toBe(false);
  });

  it('passes a minor on 0.x, and reads the largest bump across the branch', () => {
    expect(protocolBumpVerdict({ ...moved, addedChangesets: [changeset('minor')] }).ok).toBe(true);
    expect(
      protocolBumpVerdict({
        ...moved,
        addedChangesets: [changeset('patch'), changeset('minor'), { bumps: {} }],
      }).ok,
    ).toBe(true);
  });

  it('wants a major once the package is 1.0', () => {
    const past = { before: 8, after: 9, version: '1.0.0' };
    expect(protocolBumpVerdict({ ...past, addedChangesets: [changeset('minor')] }).ok).toBe(false);
    expect(protocolBumpVerdict({ ...past, addedChangesets: [changeset('major')] }).ok).toBe(true);
  });

  it('counts a bump given to another package as nothing', () => {
    expect(
      protocolBumpVerdict({ ...moved, addedChangesets: [{ bumps: { '@tyto/core': 'major' } }] }).ok,
    ).toBe(false);
  });
});
