import { describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import { vocabularyAssist } from './vocabulary-assist.js';

/** TYTO-402, ADR 0176: main's answers about a vocabulary, worded in the window's language. */

const say = (locale: 'en' | 'pt-BR') => (key: Parameters<typeof translate>[1]) =>
  translate(locale, key);

describe('the vocabulary tab’s help', () => {
  it('says what a section holds beside its suggestion, in each language', async () => {
    const ask = {
      complete: () =>
        Promise.resolve({
          answer: {
            from: 4,
            quoted: true,
            options: [
              { label: 'rules', insert: '"rules": {}', select: [10, 10] as [number, number] },
              { label: 'set', insert: '"set": {}', kind: 'property' as const },
            ],
          },
        }),
      hover: () => Promise.resolve({ answer: null }),
    };
    for (const locale of ['en', 'pt-BR'] as const) {
      const answer = await vocabularyAssist(ask, say(locale), () => undefined).complete(
        '',
        4,
        false,
      );
      expect(answer?.options[0]).toEqual({
        label: 'rules',
        insert: '"rules": {}',
        select: [10, 10],
        info: translate(locale, 'vocabulary.section.rules'),
      });
      expect(answer?.options[1]).toEqual({ label: 'set', insert: '"set": {}', kind: 'property' });
    }
  });

  it('names a table, its entries and the pointer a recipe reads it by', async () => {
    const ask = {
      complete: () => Promise.resolve({ answer: null }),
      hover: () =>
        Promise.resolve({
          answer: { from: 2, to: 9, section: 'rules' as const, name: 'a/b', entries: 2 },
        }),
    };
    const answer = await vocabularyAssist(ask, say('pt-BR'), () => 'empresa.vocab.json').hover(
      '',
      3,
    );
    expect(answer).toEqual({
      from: 2,
      to: 9,
      title: 'a/b',
      text: translate('pt-BR', 'vocabulary.section.rules'),
      facts: [
        { label: 'Entradas', value: '2' },
        { label: 'Uma receita lê como', value: '@./empresa.vocab.json#/rules/a~1b' },
      ],
    });
  });

  it('names a section over its own key, and nothing where main says nothing', async () => {
    const answers = [{ answer: { from: 0, to: 7, section: 'lookups' as const } }, { answer: null }];
    const ask = {
      complete: () => Promise.resolve({ answer: null }),
      hover: () => Promise.resolve(answers.shift() ?? { answer: null }),
    };
    const assist = vocabularyAssist(ask, say('en'), () => undefined);
    expect(await assist.hover('', 1)).toEqual({
      from: 0,
      to: 7,
      title: 'lookups',
      text: translate('en', 'vocabulary.section.lookups'),
      facts: [],
    });
    expect(await assist.hover('', 1)).toBeNull();
  });
});
