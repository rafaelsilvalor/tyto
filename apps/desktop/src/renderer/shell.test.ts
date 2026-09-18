// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { CATALOGUE_KEYS, type Locale, translate } from '../../shared/i18n/index.js';
import { en } from '../../shared/i18n/en.js';
import { ptBR } from '../../shared/i18n/pt-BR.js';
import {
  I18N_ATTRIBUTE,
  fillLocalePicker,
  localeFromPicker,
  paint,
  paintTitle,
  windowTitle,
} from './shell.js';

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

const state = (locale: Locale, document?: { name: string | undefined; dirty: boolean }) => ({
  locale,
  version: '0.1.0',
  platform: 'linux',
  templates: ['carrossel-lista', 'promo-curso'],
  templatesFolder: null,
  document: document ?? { name: undefined, dirty: false },
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

  it('names the template folder in force, and says so when there is none', () => {
    // The whole failure this setting guards against is somebody wondering why their template
    // is not in the picker, so the answer is on screen rather than buried in a settings file
    // (TYTO-122). A word and not a blank when nobody has chosen one: an empty cell in a row
    // that has a label reads as something that failed to load.
    paint(document, state('pt-BR'));
    expect(document.querySelector('[data-i18n="templates.folder.label"]')?.textContent).toBe(
      `${translate('pt-BR', 'templates.folder.label')}: ${translate('pt-BR', 'templates.folder.none')}`,
    );

    paint(document, { ...state('pt-BR'), templatesFolder: '/home/rafael/meus-templates' });
    expect(document.querySelector('[data-i18n="templates.folder.label"]')?.textContent).toBe(
      `${translate('pt-BR', 'templates.folder.label')}: /home/rafael/meus-templates`,
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

describe('the window title', () => {
  it('says the app name and that nothing is open, before anything is', () => {
    // The window opens on an empty buffer with no file behind it, and the title has to say
    // which of "nothing yet" and "something unnamed" that is.
    expect(windowTitle(state('pt-BR'))).toBe('Sem título — Tyto');
    expect(windowTitle(state('en'))).toBe('Untitled — Tyto');
  });

  it('leads with the file name, which is never translated', () => {
    const open = { name: 'campanha.brief', dirty: false };

    expect(windowTitle(state('pt-BR', open))).toBe('campanha.brief — Tyto');
    expect(windowTitle(state('en', open))).toBe('campanha.brief — Tyto');
  });

  it('says in words that there is unsaved work, not with a bullet', () => {
    // `•` is what every editor uses and it is nothing at all to a screen reader. A title is
    // plain text and has room for the word.
    const touched = { name: 'campanha.brief', dirty: true };

    expect(windowTitle(state('pt-BR', touched))).toBe('campanha.brief (não salvo) — Tyto');
    expect(windowTitle(state('en', touched))).toBe('campanha.brief (unsaved) — Tyto');
  });

  it('is what paint writes into the document title', () => {
    document.body.innerHTML = '';
    document.head.innerHTML = '<title>Tyto</title>';

    paint(document, state('pt-BR', { name: 'promo.brief', dirty: true }));

    expect(document.querySelector('title')?.textContent).toBe('promo.brief (não salvo) — Tyto');
  });

  it('can be written on its own, which is what an edit does', () => {
    // The unsaved marker is compared rather than remembered (ADR 0026), so there is no
    // first keystroke to watch for and the title is rewritten on every edit. This is the
    // call that path makes, and what it must *not* do is the `[data-i18n]` walk — the
    // heading below is left in English to prove it was not touched.
    document.body.innerHTML = `<h1 ${I18N_ATTRIBUTE}="app.name">stale</h1>`;
    document.head.innerHTML = '<title>Tyto</title>';

    paintTitle(document, state('pt-BR', { name: 'promo.brief', dirty: true }));

    expect(document.querySelector('title')?.textContent).toBe('promo.brief (não salvo) — Tyto');
    expect(document.querySelector('h1')?.textContent).toBe('stale');
  });
});
