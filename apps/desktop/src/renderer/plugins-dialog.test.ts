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
      credentials: [],
    },
    {
      name: 'pdf',
      version: '1.0.0',
      origin: 'external',
      status: 'disabled',
      contributes: ['exporter'],
      permissions: ['net:api.example.com'],
      problems: [],
      credentials: [],
    },
    {
      name: 'velho',
      version: null,
      origin: 'external',
      status: 'refused',
      contributes: [],
      permissions: [],
      problems: ["Plugin 'velho' needs plugin API >=99, and this Tyto provides plugin API 0.4.0."],
      credentials: [],
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

  it('says what the process is confined to, and that the network is not', async () => {
    const element = await dialog();

    expect(text(element, '.plugins__notice')).toBe(translate('en', 'plugins.notice'));
    expect(text(element, '.plugins__notice')).toMatch(
      /confines that process to the plugin’s own folder/u,
    );
    expect(text(element, '.plugins__notice')).toMatch(/It is not confined on the network/u);
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

  it('says, on its own row, which faces from this machine a font: permission sends', async () => {
    const element = await dialog({
      folder: VIEW.folder,
      plugins: [
        {
          ...VIEW.plugins[0]!,
          name: 'agenda',
          origin: 'external',
          contributes: ['template-pack'],
          permissions: ['font:CircularXX', 'net:api.example.com'],
        },
        { ...VIEW.plugins[0]!, name: 'svg', contributes: ['exporter'] },
      ],
    });

    expect(text(element, '[data-plugin="agenda"] .plugins__fonts')).toBe(
      `${translate('en', 'plugins.font.sendsMachineFaces')} CircularXX`,
    );
    expect(element.querySelector('[data-plugin="svg"] .plugins__fonts')).toBeNull();
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

describe('a plugin’s credentials on the screen (TYTO-187)', () => {
  const ROW = {
    ...VIEW.plugins[1]!,
    name: 'gerador',
    permissions: ['credentials:api-token', 'credentials:conta'],
    credentials: [
      { key: 'api-token', set: false },
      { key: 'conta', set: true },
    ],
  };
  const changes: { plugin: string; key: string; secret?: string }[] = [];

  async function withCredentials(refuse = false): Promise<PluginsDialog> {
    changes.length = 0;
    const element = await dialog({ folder: VIEW.folder, plugins: [ROW, VIEW.plugins[0]!] });
    element.onCredential = (change) => {
      changes.push(change);
      return refuse ? Promise.reject(new Error('refused')) : Promise.resolve();
    };
    await element.updateComplete;
    return element;
  }

  const line = (element: Element, key: string): HTMLFormElement =>
    element.querySelector<HTMLFormElement>(`[data-plugin="gerador"] [data-key="${key}"]`)!;

  it('shows each declared key with whether it is set, and Clear only where it is', async () => {
    const element = await withCredentials();

    expect(text(line(element, 'api-token'), '.plugins__credential-state')).toBe('not set');
    expect(text(line(element, 'conta'), '.plugins__credential-state')).toBe('set');
    expect(line(element, 'api-token').querySelector('.plugins__credential-clear')).toBeNull();
    expect(line(element, 'conta').querySelector('.plugins__credential-clear')).not.toBeNull();
    expect(element.querySelector('[data-plugin="svg"] .plugins__credentials')).toBeNull();
    // A password field, so what is typed is not on screen even while it is typed.
    expect(line(element, 'api-token').querySelector('input')?.type).toBe('password');
  });

  it('hands the typed value over once, and empties the field after', async () => {
    const element = await withCredentials();
    const form = line(element, 'api-token');
    const field = form.querySelector('input')!;
    field.value = 'dummy-value';

    form.requestSubmit();
    await Promise.resolve();
    await element.updateComplete;

    expect(changes).toEqual([{ plugin: 'gerador', key: 'api-token', secret: 'dummy-value' }]);
    expect(field.value).toBe('');
  });

  it('sends nothing for an empty field', async () => {
    const element = await withCredentials();
    line(element, 'api-token').requestSubmit();

    expect(changes).toEqual([]);
  });

  it('clears a key with no value at all', async () => {
    const element = await withCredentials();
    line(element, 'conta').querySelector<HTMLButtonElement>('.plugins__credential-clear')!.click();

    expect(changes).toEqual([{ plugin: 'gerador', key: 'conta' }]);
  });

  it('says so on the row when main refused the change', async () => {
    const element = await withCredentials(true);
    line(element, 'conta').querySelector<HTMLButtonElement>('.plugins__credential-clear')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;

    expect(text(line(element, 'conta'), '.plugins__credential-failed')).toBe(
      translate('en', 'plugins.credential.failed'),
    );
    expect(line(element, 'api-token').querySelector('.plugins__credential-failed')).toBeNull();
  });
});
