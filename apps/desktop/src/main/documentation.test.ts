import { describe, expect, it } from 'vitest';

import { LOCALES } from '../../shared/i18n/index.js';

import {
  DOCUMENTATION_URLS,
  documentationUrl,
  isDocumentationUrl,
  openDocumentation,
} from './documentation.js';

describe('the manual Help ▸ Documentation opens (TYTO-318)', () => {
  it('is the pt-BR edition in Portuguese and the English one otherwise', () => {
    expect(documentationUrl('pt-BR')).toBe('https://rafaelsilvalor.github.io/tyto/pt-BR/');
    expect(documentationUrl('en')).toBe('https://rafaelsilvalor.github.io/tyto/');
  });

  it('has an edition for every language the window speaks', () => {
    for (const locale of LOCALES) {
      expect(isDocumentationUrl(documentationUrl(locale)), locale).toBe(true);
    }
  });

  it('allows the two editions exactly, and nothing that only starts like them', () => {
    expect(Object.values(DOCUMENTATION_URLS).every(isDocumentationUrl)).toBe(true);
    for (const url of [
      'https://rafaelsilvalor.github.io/tyto/../evil/',
      'https://rafaelsilvalor.github.io/tyto/pt-BR/guide/',
      'https://rafaelsilvalor.github.io/tyto',
      'http://rafaelsilvalor.github.io/tyto/',
      'https://rafaelsilvalor.github.io.example.com/tyto/',
      'file:///C:/Windows/System32/calc.exe',
      '',
    ]) {
      expect(isDocumentationUrl(url), url).toBe(false);
    }
  });

  it('hands the chosen edition to the opener, once', () => {
    const opened: string[] = [];
    expect(openDocumentation('pt-BR', (url) => opened.push(url))).toBe(true);
    expect(openDocumentation('en', (url) => opened.push(url))).toBe(true);
    expect(opened).toEqual([DOCUMENTATION_URLS['pt-BR'], DOCUMENTATION_URLS.en]);
  });

  it('opens nothing for a locale the table lacks', () => {
    const opened: string[] = [];
    // A cast on purpose: the type forbids it, and this is what the check is for when it slips.
    expect(openDocumentation('fr' as 'en', (url) => opened.push(url))).toBe(false);
    expect(opened).toEqual([]);
  });
});
