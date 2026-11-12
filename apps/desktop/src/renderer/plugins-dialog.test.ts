// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import type { CredentialFileOutcome } from '../../shared/ipc.js';
import {
  type PluginInstall,
  type PluginsDialog,
  type PluginsView,
  type SigninRows,
  type SigninStart,
  PLUGINS_DIALOG_TAG,
  settingKeyOffset,
} from './plugins-dialog.js';

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
      configurable: false,
      running: false,
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
      configurable: false,
      running: false,
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
      configurable: false,
      running: false,
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

  it('names, on its own row, the programs process: permissions let it start (ADR 0182)', async () => {
    const element = await dialog({
      folder: VIEW.folder,
      plugins: [
        {
          ...VIEW.plugins[0]!,
          name: 'agente',
          origin: 'external',
          contributes: ['panel'],
          permissions: ['net:api.example.com', 'process:claude', 'process:codex'],
        },
        { ...VIEW.plugins[0]!, name: 'svg', contributes: ['exporter'] },
      ],
    });

    expect(text(element, '[data-plugin="agente"] .plugins__programs')).toBe(
      `${translate('en', 'plugins.process.starts')} claude, codex`,
    );
    expect(element.querySelector('[data-plugin="agente"] .plugins__own-programs')).toBeNull();
    expect(element.querySelector('[data-plugin="svg"] .plugins__programs')).toBeNull();
  });

  it('names a program the plugin ships apart, as its own code, and the terminal it may open (ADR 0184)', async () => {
    const element = await dialog({
      folder: VIEW.folder,
      plugins: [
        {
          ...VIEW.plugins[0]!,
          name: 'agente',
          origin: 'external',
          contributes: ['panel'],
          permissions: ['process:claude-agent-acp', 'process:codex'],
          ownPrograms: ['claude-agent-acp'],
        },
      ],
    });

    const lines = [...element.querySelectorAll('[data-plugin="agente"] .plugins__programs')].map(
      (line) => line.textContent?.replace(/\s+/gu, ' ').trim(),
    );
    expect(lines).toEqual([
      `${translate('en', 'plugins.process.starts')} codex`,
      `${translate('en', 'plugins.process.own')} claude-agent-acp`,
      translate('en', 'plugins.process.terminal'),
    ]);
  });

  it('says, on its own row, what workspace:read and workspace:write reach (ADR 0138)', async () => {
    const element = await dialog({
      folder: VIEW.folder,
      plugins: [
        {
          ...VIEW.plugins[0]!,
          name: 'tabelas',
          origin: 'external',
          contributes: ['directive'],
          permissions: ['workspace:read', 'workspace:write'],
        },
        {
          ...VIEW.plugins[0]!,
          name: 'leitor',
          origin: 'external',
          contributes: ['directive'],
          permissions: ['workspace:read'],
        },
        { ...VIEW.plugins[0]!, name: 'svg', contributes: ['exporter'] },
      ],
    });

    const lines = (name: string) =>
      [...element.querySelectorAll(`[data-plugin="${name}"] .plugins__workspace`)].map((line) =>
        line.textContent?.trim(),
      );
    expect(lines('tabelas')).toEqual([
      translate('en', 'plugins.workspace.reads'),
      translate('en', 'plugins.workspace.writes'),
    ]);
    expect(lines('leitor')).toEqual([translate('en', 'plugins.workspace.reads')]);
    expect(lines('svg')).toEqual([]);
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

/** A fake service-account key with the real one's shape, CRLF as Windows saves it (TYTO-649). */
const MULTI_LINE_KEY = `${JSON.stringify(
  {
    type: 'service_account',
    project_id: 'fake-649',
    private_key: '-----BEGIN PRIVATE KEY-----\nZmFrZS02NDk=\n-----END PRIVATE KEY-----\n',
  },
  null,
  2,
).replaceAll('\n', '\r\n')}\r\n`;

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
    // A secret field (TYTO-649): a textarea, so a key file's line breaks survive, masked by
    // `.plugins__secret` (shell.css; the real window measures the mask).
    const field = line(element, 'api-token').querySelector('textarea');
    expect(field?.classList.contains('plugins__secret')).toBe(true);
    expect(line(element, 'api-token').querySelector('input')).toBeNull();
  });

  it('hands the typed value over once, and empties the field after', async () => {
    const element = await withCredentials();
    const form = line(element, 'api-token');
    const field = form.querySelector('textarea')!;
    field.value = 'dummy-value';

    form.requestSubmit();
    await Promise.resolve();
    await element.updateComplete;

    expect(changes).toEqual([{ plugin: 'gerador', key: 'api-token', secret: 'dummy-value' }]);
    expect(field.value).toBe('');
  });

  it('hands a pasted multi-line key over with every line break (TYTO-649)', async () => {
    const element = await withCredentials();
    const form = line(element, 'api-token');
    const field = form.querySelector('textarea')!;
    field.value = MULTI_LINE_KEY;

    form.requestSubmit();
    await Promise.resolve();
    await element.updateComplete;

    // A textarea's value normalises CRLF to LF; nothing else changes.
    const sent = changes[0]?.secret ?? '';
    expect(sent).toBe(MULTI_LINE_KEY.replaceAll('\r\n', '\n'));
    expect(sent.split('\n')).toHaveLength(MULTI_LINE_KEY.split('\r\n').length);
    expect(() => JSON.parse(sent) as unknown).not.toThrow();
    expect(field.value).toBe('');
    expect(element.innerHTML).not.toContain('fake-649');
  });

  it('saves on Ctrl+Enter, since Enter is a new line in the field', async () => {
    const element = await withCredentials();
    const field = line(element, 'api-token').querySelector('textarea')!;
    field.value = 'dummy-value';

    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(changes).toEqual([]);
    field.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    expect(changes).toEqual([{ plugin: 'gerador', key: 'api-token', secret: 'dummy-value' }]);
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

describe('a credential imported from a file (TYTO-649)', () => {
  const ROW = {
    ...VIEW.plugins[1]!,
    name: 'gerador',
    permissions: ['credentials:service-account'],
    credentials: [{ key: 'service-account', set: false }],
  };

  async function importing(answer: () => Promise<CredentialFileOutcome>) {
    const element = await dialog({ folder: VIEW.folder, plugins: [ROW] });
    const asked: { plugin: string; key: string }[] = [];
    element.onCredential = () => Promise.resolve();
    element.onCredentialImport = (plugin, key) => {
      asked.push({ plugin, key });
      return answer();
    };
    await element.updateComplete;
    const form = element.querySelector<HTMLFormElement>('[data-key="service-account"]')!;
    return { element, asked, form };
  }

  const click = async (element: PluginsDialog, form: HTMLFormElement): Promise<void> => {
    form.querySelector<HTMLButtonElement>('.plugins__credential-import')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;
  };

  it('draws Import from file… only where there is somewhere to send it', async () => {
    const without = await dialog({ folder: VIEW.folder, plugins: [ROW] });
    without.onCredential = () => Promise.resolve();
    await without.updateComplete;
    expect(without.querySelector('.plugins__credential-import')).toBeNull();

    const { form } = await importing(() => Promise.resolve('stored'));
    expect(text(form, '.plugins__credential-import')).toBe('Import from file…');
  });

  it('hands over the key and nothing else, and says nothing once stored or canceled', async () => {
    for (const outcome of ['stored', 'canceled'] as const) {
      const { element, asked, form } = await importing(() => Promise.resolve(outcome));
      await click(element, form);
      expect(asked).toEqual([{ plugin: 'gerador', key: 'service-account' }]);
      expect(form.querySelector('.plugins__credential-failed')).toBeNull();
    }
  });

  it('says why when the file was too large, not text, or refused', async () => {
    for (const [answer, key] of [
      [() => Promise.resolve('too-large' as const), 'plugins.credential.tooLarge'],
      [() => Promise.resolve('not-text' as const), 'plugins.credential.notText'],
      [() => Promise.reject(new Error('refused')), 'plugins.credential.failed'],
    ] as const) {
      const { element, form } = await importing(answer);
      await click(element, form);
      expect(text(form, '.plugins__credential-failed')).toBe(translate('en', key));
    }
  });
});

describe('installing and changing a plugin from the screen (TYTO-373)', () => {
  type Answer = Awaited<ReturnType<PluginInstall>>;
  const asked: string[] = [];

  async function managed(
    view: PluginsView = VIEW,
    answer: Answer = { status: 'installed', plugin: 'novo', problems: [] },
  ): Promise<PluginsDialog> {
    asked.length = 0;
    const element = await dialog(view);
    element.onInstall = (from) => {
      asked.push(`install ${from}`);
      return Promise.resolve(answer);
    };
    element.onChange = (name, change) => {
      asked.push(`${change} ${name}`);
      return Promise.resolve(
        change === 'remove'
          ? { status: 'cancelled', problems: [] }
          : { status: 'changed', problems: [] },
      );
    };
    element.onSettings = (plugin) => {
      asked.push(`settings ${plugin}`);
    };
    await element.updateComplete;
    return element;
  }

  const actions = (element: Element, name: string): (string | undefined)[] =>
    [...element.querySelectorAll<HTMLElement>(`[data-plugin="${name}"] .plugins__action`)].map(
      (button) => button.dataset['action'],
    );

  const settle = async (element: PluginsDialog): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;
  };

  it('offers a built-in nothing, a disabled install Enable and Remove, a refused one Remove', async () => {
    const element = await managed();

    expect(actions(element, 'svg')).toEqual([]);
    expect(actions(element, 'pdf')).toEqual(['enable', 'remove']);
    expect(actions(element, 'velho')).toEqual(['remove']);
  });

  it('draws no install or row buttons while nobody owns the bridge', async () => {
    const element = await dialog();

    expect(element.querySelector('.plugins__install-folder')).toBeNull();
    expect(element.querySelector('.plugins__action')).toBeNull();
  });

  it('offers Disable on an enabled install, and Settings on one that declares settings', async () => {
    const element = await managed({
      folder: VIEW.folder,
      plugins: [
        {
          ...VIEW.plugins[1]!,
          name: 'ajustes',
          status: 'enabled',
          configurable: true,
          running: true,
        },
      ],
    });

    expect(actions(element, 'ajustes')).toEqual(['disable', 'remove', 'settings']);
    element.querySelector<HTMLButtonElement>('[data-action="settings"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-action="disable"]')!.click();
    await settle(element);

    expect(asked).toEqual(['settings ajustes', 'disable ajustes']);
    expect(text(element, '.plugins__outcome')).toBe("'ajustes' changed. Restart Tyto to apply it.");
  });

  it('says restart to apply where the disk and the running set disagree', async () => {
    const element = await managed({
      folder: VIEW.folder,
      plugins: [
        { ...VIEW.plugins[1]!, name: 'novo', status: 'enabled', running: false },
        { ...VIEW.plugins[1]!, name: 'parado', status: 'disabled', running: true },
        { ...VIEW.plugins[1]!, name: 'quieto', status: 'disabled', running: false },
        { ...VIEW.plugins[0]!, name: 'svg', running: true },
      ],
    });
    const restart = (name: string): boolean =>
      element.querySelector(`[data-plugin="${name}"] .plugins__restart`) !== null;

    expect(['novo', 'parado', 'quieto', 'svg'].map(restart)).toEqual([true, true, false, false]);
  });

  it('hands each install button its source kind, and says what was installed', async () => {
    const element = await managed();

    element.querySelector<HTMLButtonElement>('.plugins__install-archive')!.click();
    await settle(element);
    element.querySelector<HTMLButtonElement>('.plugins__install-folder')!.click();
    await settle(element);

    expect(asked).toEqual(['install archive', 'install folder']);
    expect(text(element, '.plugins__outcome')).toBe(
      "Installed 'novo'. It starts the next time Tyto starts.",
    );
  });

  it('says an unapproved install installed nothing', async () => {
    const element = await managed(VIEW, { status: 'declined', plugin: 'novo', problems: [] });

    element.querySelector<HTMLButtonElement>('.plugins__install-folder')!.click();
    await settle(element);

    expect(text(element, '.plugins__outcome')).toBe(
      "'novo' was not installed: its permissions were not approved.",
    );
  });

  it("shows main's problems when it refused, such as a built-in's name", async () => {
    const problem = "A plugin named 'svg' is already here (built-in).";
    const element = await managed(VIEW, { status: 'refused', plugin: 'svg', problems: [problem] });

    element.querySelector<HTMLButtonElement>('.plugins__install-folder')!.click();
    await settle(element);

    expect(element.querySelector('.plugins__outcome')?.getAttribute('data-key')).toBe(
      'plugins.result.refused',
    );
    expect(text(element, '.plugins__outcome .plugins__problems')).toBe(problem);
  });

  it('says nothing when the remove box was dismissed', async () => {
    const element = await managed();

    element.querySelector<HTMLButtonElement>('[data-plugin="pdf"] [data-action="remove"]')!.click();
    await settle(element);

    expect(asked).toEqual(['remove pdf']);
    expect(element.querySelector('.plugins__outcome')).toBeNull();
  });
});

describe('settingKeyOffset', () => {
  it("is just inside the quote of the plugin's first key, and nothing without one", () => {
    const settings = '{\n  "zoom": 1,\n  "ajustes.cor": "azul",\n  "ajustes.tamanho": 2\n}';

    expect(settingKeyOffset(settings, 'ajustes')).toBe(settings.indexOf('ajustes.cor'));
    // A key that merely starts with the name is another plugin's.
    expect(settingKeyOffset('{ "ajustes-extra.cor": 1 }', 'ajustes')).toBeUndefined();
  });
});

describe('browser sign-in on a plugin row (TYTO-374)', () => {
  const asked: string[] = [];

  /** `pdf` declares two sign-ins: one signed in with a label, one not signed in. */
  async function withSignins(
    signins: SigninRows = [
      {
        plugin: 'pdf',
        id: 'drive',
        signedIn: true,
        label: 'ana@example.test',
        since: '2026-11-08T12:00:00.000Z',
        client: 'manifest',
      },
      { plugin: 'pdf', id: 'sheets', signedIn: false, client: 'manifest' },
    ],
    start: SigninStart = () => Promise.resolve({ ok: true }),
  ): Promise<PluginsDialog> {
    asked.length = 0;
    const element = await dialog();
    element.signins = signins;
    element.onSigninStart = (plugin, id) => {
      asked.push(`start ${plugin} ${id}`);
      return start(plugin, id);
    };
    element.onSigninCancel = (plugin, id) => {
      if (id === 'refused') return Promise.reject(new Error('refused cancel'));
      asked.push(`cancel ${plugin} ${id}`);
      return Promise.resolve();
    };
    element.onSigninOut = (plugin, id) => {
      asked.push(`out ${plugin} ${id}`);
      return Promise.resolve();
    };
    element.onSigninClient = (plugin, id, client) => {
      if (client?.clientId === 'refused') return Promise.reject(new Error('refused'));
      asked.push(`client ${plugin} ${id} ${client === undefined ? '-' : JSON.stringify(client)}`);
      return Promise.resolve();
    };
    await element.updateComplete;
    return element;
  }

  const signin = (element: Element, id: string): HTMLElement =>
    element.querySelector<HTMLElement>(`[data-plugin="pdf"] [data-signin="${id}"]`)!;

  const settle = async (element: PluginsDialog): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;
  };

  it('says who is signed in and offers Sign out, or Not signed in and Sign in', async () => {
    const element = await withSignins();

    expect(text(signin(element, 'drive'), '.plugins__signin-state')).toBe(
      'Signed in as ana@example.test',
    );
    expect(signin(element, 'drive').querySelector('.plugins__signin-out')).not.toBeNull();
    expect(text(signin(element, 'sheets'), '.plugins__signin-state')).toBe('Not signed in');
    expect(signin(element, 'sheets').querySelector('.plugins__signin-start')).not.toBeNull();
    expect(text(element, '[data-plugin="pdf"] .plugins__signins')).toContain(
      translate('en', 'plugins.signin.kept'),
    );
    // Nothing on a row that declares none.
    expect(element.querySelector('[data-plugin="velho"] .plugins__signin')).toBeNull();
  });

  it('says Signed in, in its own words, when the provider sent no name', async () => {
    const element = await withSignins([
      {
        plugin: 'pdf',
        id: 'drive',
        signedIn: true,
        since: '2026-11-08T12:00:00.000Z',
        client: 'manifest',
      },
    ]);
    element.locale = 'pt-BR';
    await element.updateComplete;

    expect(text(signin(element, 'drive'), '.plugins__signin-state')).toBe(
      translate('pt-BR', 'plugins.signin.signedIn'),
    );
  });

  it('starts nothing until the person clicks, then hands main the plugin and the id', async () => {
    const element = await withSignins();
    expect(asked).toEqual([]);

    signin(element, 'sheets').querySelector<HTMLButtonElement>('.plugins__signin-start')!.click();
    signin(element, 'drive').querySelector<HTMLButtonElement>('.plugins__signin-out')!.click();
    await settle(element);

    expect(asked).toEqual(['start pdf sheets', 'out pdf drive']);
  });

  it('offers Cancel while waiting, and a cancelled answer frees Sign in with no failure (TYTO-646)', async () => {
    let finish: (answer: Awaited<ReturnType<SigninStart>>) => void = () => undefined;
    const element = await withSignins(
      [
        { plugin: 'pdf', id: 'sheets', signedIn: false, client: 'manifest' },
        { plugin: 'pdf', id: 'mail', signedIn: false, client: 'manifest' },
      ],
      () => new Promise((resolve) => (finish = resolve)),
    );
    expect(element.querySelector('.plugins__signin-cancel')).toBeNull();

    signin(element, 'sheets').querySelector<HTMLButtonElement>('.plugins__signin-start')!.click();
    await element.updateComplete;
    const cancel = signin(element, 'sheets').querySelector<HTMLButtonElement>(
      '.plugins__signin-cancel',
    )!;
    expect(cancel.textContent?.trim()).toBe(translate('en', 'plugins.signin.cancel'));
    expect(signin(element, 'mail').querySelector('.plugins__signin-cancel')).toBeNull();

    cancel.click();
    await settle(element);
    expect(asked).toEqual(['start pdf sheets', 'cancel pdf sheets']);
    // Main's answer to the start, once its listener closed.
    finish({ ok: false, reason: 'cancelled', message: 'the sign-in was cancelled' });
    await settle(element);

    expect(signin(element, 'sheets').querySelector('.plugins__signin-waiting')).toBeNull();
    expect(signin(element, 'sheets').querySelector('.plugins__signin-failed')).toBeNull();
    expect(
      signin(element, 'mail').querySelector<HTMLButtonElement>('.plugins__signin-start')!.disabled,
    ).toBe(false);
  });

  it('says so when main refuses the cancel, and keeps waiting (TYTO-646)', async () => {
    const element = await withSignins(
      [{ plugin: 'pdf', id: 'refused', signedIn: false, client: 'manifest' }],
      () => new Promise(() => undefined),
    );
    signin(element, 'refused').querySelector<HTMLButtonElement>('.plugins__signin-start')!.click();
    await element.updateComplete;

    signin(element, 'refused').querySelector<HTMLButtonElement>('.plugins__signin-cancel')!.click();
    await settle(element);

    expect(text(signin(element, 'refused'), '.plugins__signin-failed')).toBe(
      'The sign-in did not finish: refused cancel',
    );
    expect(signin(element, 'refused').querySelector('.plugins__signin-waiting')).not.toBeNull();
  });

  it('waits on the browser with every Sign in disabled, and says why it did not finish', async () => {
    let finish: (answer: Awaited<ReturnType<SigninStart>>) => void = () => undefined;
    const element = await withSignins(
      [
        { plugin: 'pdf', id: 'sheets', signedIn: false, client: 'manifest' },
        { plugin: 'pdf', id: 'mail', signedIn: false, client: 'manifest' },
      ],
      () => new Promise((resolve) => (finish = resolve)),
    );

    signin(element, 'sheets').querySelector<HTMLButtonElement>('.plugins__signin-start')!.click();
    await element.updateComplete;
    expect(text(signin(element, 'sheets'), '.plugins__signin-waiting')).toBe(
      'Finish signing in in your browser.',
    );
    expect(
      signin(element, 'mail').querySelector<HTMLButtonElement>('.plugins__signin-start')!.disabled,
    ).toBe(true);

    finish({ ok: false, reason: 'timeout', message: 'nothing came back within five minutes' });
    await settle(element);

    expect(signin(element, 'sheets').querySelector('.plugins__signin-waiting')).toBeNull();
    expect(text(signin(element, 'sheets'), '.plugins__signin-failed')).toBe(
      'The sign-in did not finish: nothing came back within five minutes',
    );
  });

  it('offers no client fields on a sign-in whose manifest names its client (ADR 0192)', async () => {
    const element = await withSignins();

    expect(element.querySelector('.plugins__signin-client')).toBeNull();
    expect(element.querySelector('.plugins__signin-hint')).toBeNull();
  });

  it('disables Sign in and says why until a client is set, then hands main what was typed', async () => {
    const element = await withSignins([
      { plugin: 'pdf', id: 'sheets', signedIn: false, client: 'missing' },
    ]);
    const line = signin(element, 'sheets');

    expect(line.querySelector<HTMLButtonElement>('.plugins__signin-start')!.disabled).toBe(true);
    expect(text(line, '.plugins__signin-hint')).toBe(
      translate('en', 'plugins.signin.client.needed'),
    );
    expect(text(line, '.plugins__signin-client-state')).toBe('OAuth client: not set');
    expect(line.querySelector('.plugins__signin-client-clear')).toBeNull();
    expect(line.querySelector<HTMLInputElement>('.plugins__signin-client-secret')!.type).toBe(
      'password',
    );

    line.querySelector<HTMLInputElement>('.plugins__signin-client-id')!.value = ' person-client ';
    line.querySelector<HTMLInputElement>('.plugins__signin-client-secret')!.value = 'secret';
    line.querySelector<HTMLFormElement>('.plugins__signin-client')!.requestSubmit();
    await settle(element);

    expect(asked).toEqual([
      'client pdf sheets {"clientId":"person-client","clientSecret":"secret"}',
    ]);
    // Emptied once saved: the value is on screen only while it is typed.
    expect(line.querySelector<HTMLInputElement>('.plugins__signin-client-id')!.value).toBe('');
    expect(line.querySelector<HTMLInputElement>('.plugins__signin-client-secret')!.value).toBe('');
  });

  it('sends no secret when the field is empty, and nothing at all without a client id', async () => {
    const element = await withSignins([
      { plugin: 'pdf', id: 'sheets', signedIn: false, client: 'missing' },
    ]);
    const line = signin(element, 'sheets');
    const form = line.querySelector<HTMLFormElement>('.plugins__signin-client')!;

    line.querySelector<HTMLInputElement>('.plugins__signin-client-secret')!.value = 'secret';
    form.requestSubmit();
    await settle(element);
    expect(asked).toEqual([]);

    line.querySelector<HTMLInputElement>('.plugins__signin-client-id')!.value = 'person-client';
    line.querySelector<HTMLInputElement>('.plugins__signin-client-secret')!.value = '';
    form.requestSubmit();
    await settle(element);
    expect(asked).toEqual(['client pdf sheets {"clientId":"person-client"}']);
  });

  it('says a client is set without showing it, clears it, and says when main refused', async () => {
    const element = await withSignins([
      { plugin: 'pdf', id: 'sheets', signedIn: false, client: 'set' },
    ]);
    const line = signin(element, 'sheets');

    expect(line.querySelector<HTMLButtonElement>('.plugins__signin-start')!.disabled).toBe(false);
    expect(line.querySelector('.plugins__signin-hint')).toBeNull();
    expect(text(line, '.plugins__signin-client-state')).toBe('OAuth client: set');

    line.querySelector<HTMLButtonElement>('.plugins__signin-client-clear')!.click();
    await settle(element);
    expect(asked).toEqual(['client pdf sheets -']);

    line.querySelector<HTMLInputElement>('.plugins__signin-client-id')!.value = 'refused';
    line.querySelector<HTMLFormElement>('.plugins__signin-client')!.requestSubmit();
    await settle(element);
    expect(text(line, '.plugins__signin-client-failed')).toBe(
      translate('en', 'plugins.signin.client.failed'),
    );
  });
});

describe("the plugins screen's recipe credentials (TYTO-671, ADR 0193)", () => {
  async function withRecipeCredentials(names: readonly string[] | undefined, refuse = false) {
    const element = await dialog();
    const changes: { name: string; value?: string }[] = [];
    element.recipeCredentials = names;
    element.onRecipeCredential = (name, value) => {
      changes.push(value === undefined ? { name } : { name, value });
      if (refuse) return Promise.reject(new Error('refused'));
      element.recipeCredentials = value === undefined ? [] : [name];
      return Promise.resolve();
    };
    await element.updateComplete;
    const section = element.querySelector<HTMLElement>('.plugins__recipe-credentials')!;
    const form = section.querySelector<HTMLFormElement>('.plugins__recipe-credential-form')!;
    return { element, changes, section, form };
  }

  const settled = async (element: PluginsDialog) => {
    await Promise.resolve();
    await Promise.resolve();
    await element.updateComplete;
  };

  const fill = (form: HTMLFormElement, name: string, value: string) => {
    form.querySelector<HTMLInputElement>('.plugins__recipe-credential-name')!.value = name;
    form.querySelector<HTMLInputElement>('.plugins__recipe-credential-value')!.value = value;
  };

  it('draws nothing without a place to send a change', async () => {
    const element = await dialog();
    expect(element.querySelector('.plugins__recipe-credentials')).toBeNull();
  });

  it('lists each name with Forget, and says when none is stored', async () => {
    const listed = await withRecipeCredentials(['routine', 'second-hook']);
    expect(
      [...listed.section.querySelectorAll('.plugins__recipe-credential')].map((row) =>
        row.getAttribute('data-name'),
      ),
    ).toEqual(['routine', 'second-hook']);
    expect(text(listed.section, '.plugins__recipe-credentials-title')).toBe('Recipe credentials');

    const empty = await withRecipeCredentials([]);
    expect(text(empty.section, '.plugins__recipe-credentials-none')).toBe('None stored.');
    const value = empty.section.querySelector('.plugins__recipe-credential-value');
    expect(value?.tagName).toBe('TEXTAREA');
    expect(value?.classList.contains('plugins__secret')).toBe(true);
  });

  it('keeps a pasted multi-line value whole (TYTO-649)', async () => {
    const { element, changes, form } = await withRecipeCredentials([]);
    fill(form, 'routine', MULTI_LINE_KEY);

    form.requestSubmit();
    await settled(element);

    expect(changes).toEqual([{ name: 'routine', value: MULTI_LINE_KEY.replaceAll('\r\n', '\n') }]);
  });

  it('imports a value from a file under the typed name, and says why when it did not', async () => {
    const { element, form } = await withRecipeCredentials([]);
    const asked: string[] = [];
    let answer: CredentialFileOutcome = 'too-large';
    element.onRecipeCredentialImport = (name) => {
      asked.push(name);
      return Promise.resolve(answer);
    };
    await element.updateComplete;
    const importButton = () =>
      element.querySelector<HTMLButtonElement>('.plugins__recipe-credential-import')!;

    importButton().click();
    await settled(element);
    expect(asked).toEqual([]);
    expect(text(element, '.plugins__recipe-credential-failed')).toBe(
      translate('en', 'plugins.recipeCredentials.badName'),
    );

    form.querySelector<HTMLInputElement>('.plugins__recipe-credential-name')!.value = 'routine';
    importButton().click();
    await settled(element);
    expect(asked).toEqual(['routine']);
    expect(text(element, '.plugins__recipe-credential-failed')).toBe(
      translate('en', 'plugins.credential.tooLarge'),
    );

    answer = 'stored';
    importButton().click();
    await settled(element);
    expect(element.querySelector('.plugins__recipe-credential-failed')).toBeNull();
    expect(form.querySelector<HTMLInputElement>('.plugins__recipe-credential-name')!.value).toBe(
      '',
    );
  });

  it('hands the value over once, empties the form, and never draws it', async () => {
    const { element, changes, form } = await withRecipeCredentials([]);
    fill(form, 'routine', 'typed-secret');

    form.requestSubmit();
    await settled(element);

    expect(changes).toEqual([{ name: 'routine', value: 'typed-secret' }]);
    expect(form.querySelector<HTMLInputElement>('.plugins__recipe-credential-value')!.value).toBe(
      '',
    );
    expect(element.innerHTML).not.toContain('typed-secret');
    expect(element.querySelector('[data-name="routine"]')).not.toBeNull();
  });

  it('forgets a name with no value', async () => {
    const { element, changes, section } = await withRecipeCredentials(['routine']);
    section.querySelector<HTMLButtonElement>('.plugins__recipe-credential-forget')!.click();
    await settled(element);

    expect(changes).toEqual([{ name: 'routine' }]);
  });

  it('refuses a name token= would refuse before sending, and says when main refused', async () => {
    const bad = await withRecipeCredentials([]);
    fill(bad.form, 'Routine', 'x');
    bad.form.requestSubmit();
    await settled(bad.element);
    expect(bad.changes).toEqual([]);
    expect(text(bad.element, '.plugins__recipe-credential-failed')).toBe(
      translate('en', 'plugins.recipeCredentials.badName'),
    );

    const refused = await withRecipeCredentials(['routine'], true);
    refused.section.querySelector<HTMLButtonElement>('.plugins__recipe-credential-forget')!.click();
    await settled(refused.element);
    expect(text(refused.element, '.plugins__recipe-credential-failed')).toBe(
      translate('en', 'plugins.recipeCredentials.failed'),
    );
  });
});
