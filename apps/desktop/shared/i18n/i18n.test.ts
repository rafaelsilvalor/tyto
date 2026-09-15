import { describe, expect, it } from 'vitest';

import { CATALOGUE_KEYS } from './catalogue.js';
import { en } from './en.js';
import { ptBR } from './pt-BR.js';
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALES,
  isLocale,
  localeFor,
  translate,
} from './index.js';

describe('the catalogue', () => {
  it('lists every key each locale actually has, in both directions', () => {
    // `CATALOGUE_KEYS` is what the renderer filters `data-i18n` attributes against, so a
    // key in the type but missing from the array would be a string that silently never
    // paints. The type cannot catch that; this can.
    expect([...CATALOGUE_KEYS].sort()).toEqual(Object.keys(ptBR).sort());
    expect([...CATALOGUE_KEYS].sort()).toEqual(Object.keys(en).sort());
  });

  it('translates every key in every locale, with nothing blank', () => {
    for (const locale of LOCALES) {
      for (const key of CATALOGUE_KEYS) {
        expect(translate(locale, key), `${locale} ${key}`).not.toBe('');
      }
    }
  });

  it('says something different in each locale, except where the word is the same word', () => {
    // Four keys are deliberately identical, and pinning them is what keeps the list from
    // growing by accident. `app.name` is the product. `shell.about.templates` is the domain
    // term this project uses in Portuguese too — `docs/template-authoring.md` and every card
    // say "template", and translating the label to "Modelos" here would make the window
    // disagree with the vocabulary its users already have.
    //
    // E9.2 added two of the same kind. `editor.heading` is "Brief", which is the name of the
    // file format and of the language — a Portuguese speaker writing one calls it a brief,
    // and "Resumo" would name something else. `preview.slide.label` is "Slide", which
    // Portuguese borrowed whole; "Lâmina" is what a projector manual says and not what
    // anybody making a carousel says.
    //
    // So the acceptance criterion is read as it is meant: every string that *has* a
    // translation changes. `shell.test.ts` and the end-to-end suite both count against this
    // list rather than against a hardcoded number.
    const shared = CATALOGUE_KEYS.filter((key) => ptBR[key] === en[key]);

    expect(shared).toEqual([
      'app.name',
      'editor.heading',
      'preview.slide.label',
      // "Template" is the word in both languages, the same way "Slide" is: it is what the
      // frontmatter key is called and what a Portuguese speaker says out loud.
      'template.label',
      'shell.about.templates',
    ]);
  });
});

describe('which locale an app opens in', () => {
  it('offers pt-BR first, and falls back through en', () => {
    expect(LOCALES[0]).toBe('pt-BR');
    expect(DEFAULT_LOCALE).toBe('pt-BR');
    expect(FALLBACK_LOCALE).toBe('en');
  });

  it('takes an exact match', () => {
    expect(localeFor('pt-BR')).toBe('pt-BR');
    expect(localeFor('en')).toBe('en');
  });

  it('matches on the language when the region does not match', () => {
    // A machine set to European Portuguese gets Portuguese. Sending it to English because
    // `PT` is not `BR` would be a worse answer than an imperfect Portuguese one.
    expect(localeFor('pt-PT')).toBe('pt-BR');
    expect(localeFor('pt')).toBe('pt-BR');
    expect(localeFor('en-GB')).toBe('en');
    expect(localeFor('EN-us')).toBe('en');
  });

  it('lands on pt-BR for a locale nobody wrote, and for no locale at all', () => {
    expect(localeFor('ja-JP')).toBe('pt-BR');
    expect(localeFor('')).toBe('pt-BR');
    expect(localeFor(undefined)).toBe('pt-BR');
  });

  it('knows which strings are locales', () => {
    expect(isLocale('pt-BR')).toBe(true);
    expect(isLocale('pt-PT')).toBe(false);
  });
});
