// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { paintUpdateNotice } from './update-notice.js';

const button = (): HTMLButtonElement => document.createElement('button');

describe('paintUpdateNotice', () => {
  it('is hidden while there is nothing newer', () => {
    const notice = button();
    paintUpdateNotice(notice, { state: 'ready', version: '0.7.0' }, 'en');
    paintUpdateNotice(notice, { state: 'none' }, 'en');

    expect(notice.hidden).toBe(true);
    expect(notice.textContent).toBe('');
    expect(notice.dataset['updateState']).toBe('none');
  });

  it('names the version, in each locale', () => {
    const notice = button();
    paintUpdateNotice(notice, { state: 'ready', version: '0.7.0' }, 'en');
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe('Version 0.7.0 is ready — Restart to update');

    paintUpdateNotice(notice, { state: 'ready', version: '0.7.0' }, 'pt-BR');
    expect(notice.textContent).toBe('Versão 0.7.0 pronta — Reiniciar para atualizar');
  });

  it('cannot be clicked while the download runs, and can once it offers something', () => {
    const notice = button();
    paintUpdateNotice(notice, { state: 'downloading', version: '0.7.0' }, 'en');
    expect(notice.disabled).toBe(true);
    expect(notice.textContent).toBe('Downloading version 0.7.0');

    paintUpdateNotice(notice, { state: 'available', version: '0.7.0', url: 'https://x/' }, 'en');
    expect(notice.disabled).toBe(false);
    expect(notice.textContent).toBe('Version 0.7.0 available — Download');
  });
});
