import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  aliasWriteProblem,
  aliasesAnswer,
  projectTextWithAlias,
  writeWorkspaceAlias,
} from './command-aliases.js';

/** The command panel's aliases as main reads and writes them (TYTO-536). */

const COMMENTED = [
  '{',
  '  // Where this project keeps its templates.',
  '  "templates": ["tpl"],',
  '',
  '  /* Exports go here. */',
  '  "output": "out"',
  '}',
  '',
].join('\n');

describe('projectTextWithAlias', () => {
  it('adds an aliases key to a commented file, keeping every comment and blank line', () => {
    const next = projectTextWithAlias(COMMENTED, 'entrega', 'render --delivery');
    expect(next).toBe(
      [
        '{',
        '  // Where this project keeps its templates.',
        '  "templates": ["tpl"],',
        '',
        '  /* Exports go here. */',
        '  "output": "out",',
        '  "aliases": {',
        '    "entrega": "render --delivery"',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('sets one alias of an existing key and removes one, touching no other', () => {
    const text = '{\n  "aliases": {\n    // mine\n    "a": "render",\n    "b": "check"\n  }\n}\n';
    expect(projectTextWithAlias(text, 'a', 'render --formats png')).toBe(
      '{\n  "aliases": {\n    // mine\n    "a": "render --formats png",\n    "b": "check"\n  }\n}\n',
    );
    expect(projectTextWithAlias(text, 'b', null)).toBe(
      '{\n  "aliases": {\n    // mine\n    "a": "render"\n  }\n}\n',
    );
  });

  it('writes nothing over a file that does not parse', () => {
    expect(projectTextWithAlias('{ "output": ', 'a', 'render')).toBeUndefined();
  });
});

describe('writeWorkspaceAlias', () => {
  let folder: string;
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'tyto-aliases-'));
  });
  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });
  const file = () => join(folder, '.tyto', 'project.json');

  it("writes the folder's own project file, making it when it is missing", async () => {
    expect(await writeWorkspaceAlias(folder, 'entrega', 'render')).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(file(), 'utf8'))).toEqual({ aliases: { entrega: 'render' } });
  });

  it('refuses a file that does not parse and leaves it as it was', async () => {
    mkdirSync(join(folder, '.tyto'));
    writeFileSync(file(), '{ broken', 'utf8');
    expect(await writeWorkspaceAlias(folder, 'entrega', 'render')).toEqual({
      ok: false,
      reason: 'syntax',
    });
    expect(readFileSync(file(), 'utf8')).toBe('{ broken');
  });
});

describe('aliasesAnswer', () => {
  it("puts the workspace's over the person's, name by name, and says what the folder allows", () => {
    expect(
      aliasesAnswer(
        { entrega: 'render', mine: 'check' },
        { trust: 'trusted', aliases: [{ name: 'entrega', body: 'render --delivery' }] },
      ),
    ).toEqual({
      aliases: [
        { name: 'entrega', body: 'render --delivery', definedIn: 'workspace' },
        { name: 'mine', body: 'check', definedIn: 'user' },
      ],
      workspace: 'trusted',
    });
    expect(aliasesAnswer({}, { trust: 'revoked', aliases: [] }).workspace).toBe('restricted');
    expect(aliasesAnswer({}, undefined).workspace).toBe('none');
  });
});

describe('aliasWriteProblem', () => {
  it('refuses what the readers would refuse', () => {
    expect(aliasWriteProblem('entrega', 'render')).toBeUndefined();
    expect(aliasWriteProblem('entrega', null)).toBeUndefined();
    expect(aliasWriteProblem('two words', 'render')).toBe('invalid');
    expect(aliasWriteProblem('x', 'render\nrm a')).toBe('invalid');
  });
});
