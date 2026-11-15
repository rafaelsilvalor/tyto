import { describe, expect, it } from 'vitest';

import { aliasWriteProblem, aliasesAnswer } from './command-aliases.js';

/** The command panel's aliases as main reads and writes them (TYTO-536). */

describe('aliasesAnswer', () => {
  it("puts the workspace's over the person's, name by name", () => {
    expect(
      aliasesAnswer({ entrega: 'render', mine: 'check' }, [
        { name: 'entrega', body: 'render --delivery' },
      ]),
    ).toEqual({
      aliases: [
        { name: 'entrega', body: 'render --delivery', definedIn: 'workspace' },
        { name: 'mine', body: 'check', definedIn: 'user' },
      ],
    });
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
