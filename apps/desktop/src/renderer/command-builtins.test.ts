import { describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import {
  type BuiltinContext,
  BuiltinRegistry,
  PANEL_BUILTINS,
  type PanelBuiltin,
  tytoCommandOf,
} from './command-builtins.js';
import { parseCommandLine } from './command-steps.js';

/** The command panel's own commands as a registry (TYTO-535, ADR 0200). */

const word = (text: string, quoted = false) => ({ text, quoted });

function context(
  overrides: Partial<BuiltinContext> & { readonly ran?: (readonly string[])[] } = {},
): BuiltinContext {
  const ran = overrides.ran ?? [];
  return {
    args: [],
    history: () => [],
    runTyto: (_line, words) => {
      ran.push(words);
      return Promise.resolve(true);
    },
    clear: () => undefined,
    exit: () => undefined,
    commands: () => Promise.resolve([{ name: 'render', description: 'render a brief' }]),
    say: (key) => translate('en', key),
    registry: PANEL_BUILTINS,
    ...overrides,
  };
}

const named = (name: string): PanelBuiltin => PANEL_BUILTINS.find(word(name))!;

describe('the registry', () => {
  it('finds an entry by its name or an alias, never by a quoted word', () => {
    expect(PANEL_BUILTINS.find(word('cls'))?.name).toBe('clear');
    expect(PANEL_BUILTINS.find(word('clear', true))).toBeUndefined();
    expect(PANEL_BUILTINS.find(word('render'))).toBeUndefined();
  });

  it('lists every name and alias for completion, each with its entry', () => {
    expect(PANEL_BUILTINS.names().map((each) => each.name)).toEqual([
      'clear',
      'cls',
      'exit',
      'help',
      'history',
      'last',
    ]);
  });

  it('refuses two entries under one name', () => {
    const one = named('clear');
    expect(() => new BuiltinRegistry([one, { ...one, name: 'other', aliases: ['clear'] }])).toThrow(
      'two built-ins named clear',
    );
  });

  it('marks every built-in of this card as safe in a restricted folder: none writes', () => {
    expect(PANEL_BUILTINS.entries.every((entry) => entry.runsInRestrictedFolder)).toBe(true);
  });
});

describe('history', () => {
  it('numbers the entries from 1, as !N reads them', async () => {
    const outcome = await named('history').run(
      context({ history: () => Array.from({ length: 10 }, (_, index) => `check ${index}.brief`) }),
    );
    expect(outcome.kind === 'printed' && outcome.lines.slice(0, 2)).toEqual([
      ' 1  check 0.brief',
      ' 2  check 1.brief',
    ]);
    expect(outcome.kind === 'printed' && outcome.lines.at(-1)).toBe('10  check 9.brief');
  });

  it('says so when there is none', async () => {
    expect(await named('history').run(context())).toEqual({
      kind: 'printed',
      lines: ['Nothing has been run in this folder yet.'],
    });
  });
});

describe('last', () => {
  it('reruns the newest single tyto command, passing over built-ins, !N and chains', async () => {
    const ran: (readonly string[])[] = [];
    const outcome = await named('last').run(
      context({
        ran,
        history: () => [
          'check old.brief',
          'tyto render a.brief --types svg',
          'check a.brief && render a.brief',
          'history',
          '!2',
          '"clear"',
          'help',
        ],
      }),
    );
    // `"clear"` is quoted, so it names no built-in: it was a `tyto` command, and the newest.
    expect(ran).toEqual([['clear']]);
    expect(outcome).toEqual({ kind: 'acted', ok: true });
  });

  it('drops a leading tyto, as the panel does', () => {
    expect(tytoCommandOf('tyto render a.brief', PANEL_BUILTINS)).toEqual(['render', 'a.brief']);
    expect(tytoCommandOf('last', PANEL_BUILTINS)).toBeUndefined();
  });

  it('fails, with a line, when there is nothing to rerun', async () => {
    expect(await named('last').run(context({ history: () => ['history', 'exit'] }))).toEqual({
      kind: 'printed',
      lines: ['No tyto command in the history to run again.'],
      failed: true,
    });
  });
});

describe('help', () => {
  it("lists the panel's own commands, the line syntax, then the CLI's commands", async () => {
    const outcome = await named('help').run(context());
    if (outcome.kind !== 'printed') throw new Error(outcome.kind);
    expect(outcome.lines[0]).toBe("The panel's own commands:");
    expect(outcome.lines).toContain(
      `  clear, cls  ${translate('en', 'commandPanel.builtin.clear')}`,
    );
    expect(outcome.lines.some((line) => line.trimStart().startsWith('!N'))).toBe(true);
    expect(outcome.lines.some((line) => line.trimStart().startsWith('a && b'))).toBe(true);
    expect(outcome.lines.at(-1)).toBe('  render      render a brief');
  });

  it("answers help <built-in> itself, and help <command> with the CLI's own help", async () => {
    expect(await named('help').run(context({ args: [word('exit')] }))).toEqual({
      kind: 'printed',
      lines: ['exit  close this session'],
    });
    const ran: (readonly string[])[] = [];
    await named('help').run(context({ ran, args: [word('plugin'), word('list')] }));
    expect(ran).toEqual([['plugin', 'list', '--help']]);
  });
});

describe('clear and exit', () => {
  it('act on the session and print nothing', async () => {
    const did: string[] = [];
    const hands = context({ clear: () => did.push('clear'), exit: () => did.push('exit') });
    expect(await named('cls').run(hands)).toEqual({ kind: 'acted', ok: true });
    expect(await named('exit').run(hands)).toEqual({ kind: 'ended' });
    expect(did).toEqual(['clear', 'exit']);
  });
});

it('hands the registry the first word of a step as the parser reads it', () => {
  const parsed = parseCommandLine('cls && "cls"');
  if (!parsed.ok) throw new Error('parse');
  expect(parsed.steps.map((step) => PANEL_BUILTINS.find(step.words[0])?.name)).toEqual([
    'clear',
    undefined,
  ]);
});
