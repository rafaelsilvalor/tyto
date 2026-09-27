// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import { type PluginsDialog, type PluginsView, PLUGINS_DIALOG_TAG } from './plugins-dialog.js';

/**
 * The plugins screen's states, as jsdom can see them: which rows, which words, which notice.
 * Whether the table is legible is `e2e/plugins.desktop.test.ts`'s question — jsdom does no
 * layout, and a green suite has shipped an unreadable dialog in this repository before.
 */

const VIEW: PluginsView = {
  folder: '/home/ana/.tyto/plugins',
  plugins: [
    {
      name: 'svg',
      version: '1.0.2',
      origin: 'built-in',
      status: 'enabled',
      contributes: ['exporter'],
      permissions: [],
      problems: [],
    },
    {
      name: 'pdf',
      version: '1.0.0',
      origin: 'external',
      status: 'disabled',
      contributes: ['exporter'],
      permissions: ['net:api.example.com'],
      problems: [],
    },
    {
      name: 'velho',
      version: null,
      origin: 'external',
      status: 'refused',
      contributes: [],
      permissions: [],
      problems: ["Plugin 'velho' needs plugin API >=99, and this Tyto provides plugin API 0.4.0."],
    },
  ],
};

async function dialog(view: PluginsView | 'failed' | undefined = VIEW): Promise<PluginsDialog> {
  const element = document.createElement(PLUGINS_DIALOG_TAG) as PluginsDialog;
  document.body.append(element);
  element.locale = 'en';
  element.view = view;
  element.open = true;
  await element.updateComplete;
  return element;
}

const text = (element: Element, selector: string): string =>
  element.querySelector(selector)?.textContent?.replace(/\s+/gu, ' ').trim() ?? '';

describe('the plugins screen', () => {
  it('renders nothing while closed', async () => {
    const element = await dialog();
    element.close();
    await element.updateComplete;

    expect(element.querySelector('.plugins__panel')).toBeNull();
  });

  it('says how far permissions reach, and that the process is not a sandbox', async () => {
    const element = await dialog();

    expect(text(element, '.plugins__notice')).toBe(translate('en', 'plugins.notice'));
    expect(text(element, '.plugins__notice')).toMatch(/not a sandbox/u);
    expect(text(element, '.plugins__notice')).toMatch(/filter only what a plugin asks of Tyto/u);
  });

  it('lists every plugin with its origin and status in the window language', async () => {
    const element = await dialog();
    const rows = [...element.querySelectorAll('.plugins__row')].map((row) =>
      [...row.querySelectorAll('td')].slice(0, 4).map((cell) => cell.textContent?.trim()),
    );

    expect(rows).toEqual([
      ['svg', '1.0.2', 'built-in', 'enabled'],
      ['pdf', '1.0.0', 'installed', 'disabled'],
      ['velho', '—', 'installed', 'refused'],
    ]);
  });

  it('names each permission, and says none where there is none', async () => {
    const element = await dialog();

    expect(text(element, '[data-plugin="pdf"] .plugins__permissions')).toBe('net:api.example.com');
    expect(text(element, '[data-plugin="svg"] .plugins__permissions')).toBe('none');
  });

  it('shows why a refused plugin will not load', async () => {
    const element = await dialog();

    expect(text(element, '[data-plugin="velho"] .plugins__problems')).toMatch(/plugin API >=99/u);
  });

  it('says where installed plugins live', async () => {
    const element = await dialog();

    expect(text(element, '.plugins__folder code')).toBe('/home/ana/.tyto/plugins');
  });

  it('says so when the list could not be read, instead of an empty table', async () => {
    const element = await dialog('failed');

    expect(element.querySelector('.plugins__table')).toBeNull();
    expect(text(element, '.plugins__failure')).toBe(translate('en', 'plugins.unavailable'));
  });

  it('follows the window into Portuguese', async () => {
    const element = await dialog();
    element.locale = 'pt-BR';
    await element.updateComplete;

    expect(text(element, '.plugins__title')).toBe('Plugins do Tyto');
    expect(text(element, '[data-plugin="pdf"] .plugins__status')).toBe('desativado');
  });

  it('says, on its own row, that a plugin with a panel receives the open brief', async () => {
    const element = await dialog({
      folder: VIEW.folder,
      plugins: [
        { ...VIEW.plugins[0]!, name: 'painel', origin: 'external', contributes: ['panel'] },
        { ...VIEW.plugins[0]!, name: 'svg', contributes: ['exporter'] },
      ],
    });

    expect(text(element, '[data-plugin="painel"] .plugins__disclosure')).toBe(
      translate('en', 'plugins.panel.readsDocument'),
    );
    expect(element.querySelector('[data-plugin="svg"] .plugins__disclosure')).toBeNull();
  });

  it('closes on Escape', async () => {
    const element = await dialog();
    element
      .querySelector('.plugins__panel')
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await element.updateComplete;

    expect(element.open).toBe(false);
  });
});
