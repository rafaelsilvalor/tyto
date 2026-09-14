// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { CATALOGUE_KEYS, type Locale, translate } from '../../shared/i18n/index.js';
import { en } from '../../shared/i18n/en.js';
import { ptBR } from '../../shared/i18n/pt-BR.js';
import { I18N_ATTRIBUTE, fillLocalePicker, localeFromPicker, paint } from './shell.js';

/**
 * The acceptance criterion — *switching locale changes every visible string* — as a unit.
 *
 * The end-to-end suite asserts the same thing through a real window, which is what proves
 * the markup carries the attributes. This asserts the half that does not need a browser:
 * that a repaint reaches every marked element, for every key the catalogue has. Run here as
 * well as there because this one runs in `pnpm check` and the other one does not.
 */

const markup = (...keys: readonly string[]): string =>
  keys.map((key) => `<p ${I18N_ATTRIBUTE}="${key}">untranslated</p>`).join('');

const state = (locale: Locale) => ({
  locale,
  version: '0.1.0',
  platform: 'linux',
  templates: ['carrossel-lista', 'promo-curso'],
});

describe('paint', () => {
  beforeEach(() => {
    document.body.innerHTML = markup(...CATALOGUE_KEYS);
  });

  it('writes every element the catalogue owns', () => {
    paint(document, state('pt-BR'));

    for (const key of CATALOGUE_KEYS) {
      const element = document.querySelector(`[${I18N_ATTRIBUTE}="${key}"]`);
      expect(element?.textContent, key).not.toBe('untranslated');
      expect(element?.textContent, key).toContain(translate('pt-BR', key));
    }
  });

  it('changes every one of them when the locale changes', () => {
    paint(document, state('pt-BR'));
    const before = [...document.querySelectorAll(`[${I18N_ATTRIBUTE}]`)].map(
      (element) => element.textContent,
    );

    paint(document, state('en'));
    const after = [...document.querySelectorAll(`[${I18N_ATTRIBUTE}]`)].map(
      (element) => element.textContent,
    );

    // Every string that differs between the two catalogues has to differ on screen. Counted
    // from the catalogues rather than against a literal, so a key added later is covered the
    // day it is added; `i18n.test.ts` is what pins which keys are deliberately the same in
    // both.
    const translated = CATALOGUE_KEYS.filter((key) => ptBR[key] !== en[key]).length;
    const changed = before.filter((text, index) => text !== after[index]).length;

    expect(before).not.toEqual(after);
    expect(changed).toBe(translated);
  });

  it('splices the machine facts into the two keys that take one', () => {
    paint(document, state('pt-BR'));

    expect(document.querySelector('[data-i18n="shell.about.version"]')?.textContent).toBe(
      `${translate('pt-BR', 'shell.about.version')}: 0.1.0`,
    );
    expect(document.querySelector('[data-i18n="shell.about.platform"]')?.textContent).toBe(
      `${translate('pt-BR', 'shell.about.platform')}: linux`,
    );
    expect(document.querySelector('[data-i18n="shell.about.templates"]')?.textContent).toBe(
      `${translate('pt-BR', 'shell.about.templates')}: 2`,
    );
  });

  it('leaves an element alone whose key the catalogue does not have', () => {
    // Recoverable beats blank: a stale string is readable and an empty one is not.
    document.body.innerHTML = `<p ${I18N_ATTRIBUTE}="shell.nothing">kept</p>`;
    paint(document, state('en'));

    expect(document.body.textContent).toBe('kept');
  });

  it('sets the document language, which is what a screen reader reads', () => {
    paint(document, state('en'));
    expect(document.documentElement.lang).toBe('en');

    paint(document, state('pt-BR'));
    expect(document.documentElement.lang).toBe('pt-BR');
  });
});

describe('the language picker', () => {
  it('offers every locale, in offer order, with the current one selected', () => {
    const picker = document.createElement('select');
    fillLocalePicker(picker, 'en');

    expect([...picker.options].map((option) => option.value)).toEqual(['pt-BR', 'en']);
    expect(picker.value).toBe('en');
  });

  it('names each language in its own language, not in the window’s', () => {
    // A translated language list is the one list that is harder to use translated.
    const picker = document.createElement('select');
    fillLocalePicker(picker, 'pt-BR');

    expect([...picker.options].map((option) => option.textContent)).toEqual([
      'Português (Brasil)',
      'English',
    ]);
  });

  it('keeps the current locale when the picker holds something that is not one', () => {
    const picker = document.createElement('select');
    fillLocalePicker(picker, 'pt-BR');
    const stray = document.createElement('option');
    stray.value = 'ja-JP';
    picker.append(stray);
    picker.value = 'ja-JP';

    expect(localeFromPicker(picker, 'pt-BR')).toBe('pt-BR');
  });
});
