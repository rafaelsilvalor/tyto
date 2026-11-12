import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { permissionPrompt } from '@tyto/command-line';
import { PLUGIN_API_VERSION, type PluginManifest } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import { fileCredentialStore } from './credential-store.js';
import { type Credentials, createCredentials } from './credentials.js';
import { credentialAccount } from './installed-plugins.js';
import {
  type ManageBox,
  type PluginManagerOptions,
  approveInstallInABox,
  confirmRemoveInABox,
  createPluginManager,
  forgetPluginSecrets,
} from './plugin-manage.js';
import { signinAccount, signinClientAccount } from './signin.js';

/**
 * The plugins screen's install and changes (TYTO-373), against a real `TYTO_HOME` in the temp
 * space and the CLI's own steps. Only the picker and the two boxes are stand-ins: they are
 * Electron's, and what matters here is what each answer does to the disk.
 */

let scratch: string;
let home: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'tyto-plugin-manage-'));
  home = join(scratch, 'home');
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function pluginFolder(name = 'texto', permissions: readonly string[] = []): Promise<string> {
  const folder = join(scratch, 'source', name);
  await mkdir(join(folder, 'dist'), { recursive: true });
  await writeFile(
    join(folder, 'tyto-plugin.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: `>=${PLUGIN_API_VERSION}`,
      contributes: ['exporter'],
      permissions,
    }),
  );
  await writeFile(join(folder, 'dist', 'index.js'), 'export function activate() {}\n');
  return folder;
}

const installedFolders = (): Promise<readonly string[]> =>
  readdir(join(home, 'plugins')).catch(() => []);

const state = async (): Promise<Record<string, { enabled: boolean }>> =>
  (
    JSON.parse(await readFile(join(home, 'plugins.json'), 'utf8')) as {
      plugins: Record<string, { enabled: boolean }>;
    }
  ).plugins;

const say = (key: Parameters<Parameters<typeof approveInstallInABox>[1]>[0]): string =>
  translate('en', key);

/** A box that records what it was shown and answers with `response`. */
function box(
  response: number,
  checkboxChecked = false,
): {
  shown: ManageBox[];
  show: (shown: ManageBox) => Promise<{ response: number; checkboxChecked: boolean }>;
} {
  const shown: ManageBox[] = [];
  return {
    shown,
    show: (item) => {
      shown.push(item);
      return Promise.resolve({ response, checkboxChecked });
    },
  };
}

function manager(overrides: Partial<PluginManagerOptions> & { picked?: string }) {
  const asked: string[] = [];
  const options: PluginManagerOptions = {
    home,
    cwd: scratch,
    // `svg` is the CLI's built-in too; `embutido` stands for one only this app ships.
    builtInNames: () => new Set(['svg', 'embutido']),
    choose: (from) => {
      asked.push(`choose ${from}`);
      return Promise.resolve(overrides.picked);
    },
    approve: (manifest) => {
      asked.push(`approve ${manifest.name}`);
      return Promise.resolve(true);
    },
    confirmRemove: (name) => {
      asked.push(`remove ${name}`);
      return Promise.resolve({ remove: true, forget: false });
    },
    forgetSecrets: (name) => {
      asked.push(`forget ${name}`);
      return Promise.resolve([]);
    },
    ...overrides,
  };
  return { asked, plugins: createPluginManager(options) };
}

const MANIFEST: PluginManifest = {
  name: 'tabelas',
  version: '1.0.0',
  engine: `>=${PLUGIN_API_VERSION}`,
  contributes: ['directive'],
  permissions: ['net:api.example.com', 'workspace:read', 'workspace:write'],
};

describe('the install box', () => {
  it('shows the text tyto plugin install prints, with Cancel as default and as Escape', async () => {
    const answer = box(0);

    expect(await approveInstallInABox(answer.show, say)(MANIFEST, '/x/tabelas')).toBe(true);
    const shown = answer.shown[0]!;
    expect(shown.detail).toBe(permissionPrompt(MANIFEST, '/x/tabelas'));
    // The workspace line the CLI prints is in the window's box too.
    expect(shown.detail).toMatch(/workspace: permissions let Tyto read and write files/u);
    expect(shown.message).toBe("Install 'tabelas'? It asks for these permissions.");
    expect([shown.buttons, shown.defaultId, shown.cancelId]).toEqual([['Install', 'Cancel'], 1, 1]);
  });

  it('approves nothing when the box is dismissed or answered with anything but Install', async () => {
    for (const response of [1, 2, -1]) {
      expect(
        await approveInstallInABox(box(response).show, say)(MANIFEST, 'x'),
        String(response),
      ).toBe(false);
    }
  });
});

describe('the remove box', () => {
  it('names the plugin, defaults to Cancel, and removes only on Remove', async () => {
    const dismissed = box(1);
    expect(await confirmRemoveInABox(dismissed.show, say)('pdf')).toEqual({
      remove: false,
      forget: false,
    });
    expect(dismissed.shown[0]).toMatchObject({
      type: 'warning',
      message: "Remove 'pdf'?",
      buttons: ['Remove', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    expect(await confirmRemoveInABox(box(0).show, say)('pdf')).toEqual({
      remove: true,
      forget: false,
    });
  });

  it('offers to forget the secrets in an unticked checkbox, in both languages (TYTO-682)', async () => {
    const shown = box(0);
    await confirmRemoveInABox(shown.show, say)('pdf');
    expect(shown.shown[0]).toMatchObject({
      checkboxLabel: "Also forget this plugin's saved credentials and sign-ins",
      checkboxChecked: false,
    });

    const portuguese = box(0);
    await confirmRemoveInABox(portuguese.show, (key) => translate('pt-BR', key))('pdf');
    expect(portuguese.shown[0]?.checkboxLabel).toBe(
      'Também esquecer as credenciais e os logins salvos deste plugin',
    );
  });

  it('forgets only when the box was ticked and Remove pressed', async () => {
    expect(await confirmRemoveInABox(box(0, true).show, say)('pdf')).toEqual({
      remove: true,
      forget: true,
    });
    // Ticked, then Cancel or Escape: a no to both.
    expect(await confirmRemoveInABox(box(1, true).show, say)('pdf')).toEqual({
      remove: false,
      forget: false,
    });
  });
});

describe('installing from the window', () => {
  it('installs a picked folder once approved, with exactly the permissions shown', async () => {
    const folder = await pluginFolder('texto', ['net:api.example.com']);
    const { asked, plugins } = manager({ picked: folder });

    expect(await plugins.install('folder')).toEqual({
      status: 'installed',
      plugin: 'texto',
      problems: [],
    });
    expect(asked).toEqual(['choose folder', 'approve texto']);
    expect(await installedFolders()).toEqual(['texto']);
    expect(await state()).toMatchObject({
      texto: { enabled: true, permissions: ['net:api.example.com'], source: folder },
    });
  });

  it('installs nothing when the box was not approved', async () => {
    const folder = await pluginFolder();
    const { plugins } = manager({
      picked: folder,
      approve: approveInstallInABox(box(1).show, say),
    });

    expect(await plugins.install('folder')).toMatchObject({ status: 'declined', plugin: 'texto' });
    expect(await installedFolders()).toEqual([]);
  });

  it('does nothing at all when the picker was closed', async () => {
    const { asked, plugins } = manager({});

    expect(await plugins.install('archive')).toEqual({ status: 'cancelled', problems: [] });
    expect(asked).toEqual(['choose archive']);
  });

  it('refuses a picked file that is not a .tgz rather than hand it to npm', async () => {
    const file = join(scratch, 'plugin.zip');
    await writeFile(file, 'not an archive');
    const { asked, plugins } = manager({ picked: file });

    const answer = await plugins.install('archive');

    expect(answer.status).toBe('refused');
    expect(answer.problems[0]).toMatch(/not a \.tgz or \.tar\.gz archive/u);
    expect(asked).toEqual(['choose archive']);
  });

  it("refuses a built-in's name before anybody is asked, and installs nothing", async () => {
    // One only this app ships, which the CLI's list does not know: this module's own check.
    const desktopOnly = manager({ picked: await pluginFolder('embutido') });
    expect(await desktopOnly.plugins.install('folder')).toEqual({
      status: 'refused',
      plugin: 'embutido',
      problems: ["A plugin named 'embutido' is already here (built-in)."],
    });
    expect(desktopOnly.asked).toEqual(['choose folder']);

    // One both apps ship, which `installPlugin` refuses before this module sees it.
    const shared = manager({ picked: await pluginFolder('svg') });
    expect(await shared.plugins.install('folder')).toEqual({
      status: 'refused',
      problems: ["A plugin named 'svg' is already here (built-in)."],
    });
    expect(shared.asked).toEqual(['choose folder']);
    expect(await installedFolders()).toEqual([]);
  });
});

describe('changing an installed plugin from the window', () => {
  async function installedTexto(): Promise<void> {
    const folder = await pluginFolder();
    await manager({ picked: folder }).plugins.install('folder');
  }

  it('removes only after the box said Remove, and keeps everything when it was dismissed', async () => {
    await installedTexto();

    const kept = manager({ confirmRemove: confirmRemoveInABox(box(1).show, say) });
    expect(await kept.plugins.change('texto', 'remove')).toEqual({
      status: 'cancelled',
      problems: [],
    });
    expect(await installedFolders()).toEqual(['texto']);
    expect(Object.keys(await state())).toEqual(['texto']);

    const removed = manager({});
    expect(await removed.plugins.change('texto', 'remove')).toEqual({
      status: 'changed',
      problems: [],
    });
    expect(removed.asked).toEqual(['remove texto']);
    expect(await installedFolders()).toEqual([]);
    expect(await state()).toEqual({});
  });

  it('forgets nothing when the remove was refused, even with the box ticked', async () => {
    const { asked, plugins } = manager({
      confirmRemove: () => Promise.resolve({ remove: true, forget: true }),
    });

    expect((await plugins.change('nenhum', 'remove')).status).toBe('refused');
    expect(asked).not.toContain('forget nenhum');
  });

  it('disables and enables without asking, in plugins.json', async () => {
    await installedTexto();
    const { asked, plugins } = manager({});

    await plugins.change('texto', 'disable');
    expect((await state())['texto']?.enabled).toBe(false);
    await plugins.change('texto', 'enable');
    expect((await state())['texto']?.enabled).toBe(true);
    expect(asked).toEqual([]);
  });

  it("answers the CLI's refusal for a name that is not installed", async () => {
    const answer = await manager({}).plugins.change('nenhum', 'disable');

    expect(answer.status).toBe('refused');
    expect(answer.problems).toHaveLength(1);
  });

  it("rejects a built-in's name, which the screen never offers", async () => {
    await expect(manager({}).plugins.change('svg', 'remove')).rejects.toThrow(/built into Tyto/u);
  });
});

/**
 * TYTO-682: the keychain a remove forgets, as the files main writes — `fileCredentialStore` over
 * a folder in the temp space, and `credentials.ts` with a stand-in cipher, since deleting never
 * decrypts. Every assertion reads the folder on disk, not the store's own answer.
 */
describe("forgetting a removed plugin's secrets", () => {
  let keychain: string;
  let credentials: Credentials;

  beforeEach(() => {
    keychain = join(scratch, 'userData', 'credentials');
    credentials = createCredentials({
      store: fileCredentialStore(keychain),
      encryption: {
        isEncryptionAvailable: () => true,
        encryptString: (text) => Buffer.from(`sealed:${text}`),
        decryptString: (sealed) => sealed.toString().replace(/^sealed:/u, ''),
      },
    });
  });

  /** The keychain folder's files, decoded back to their account names. */
  const onDisk = async (): Promise<readonly string[]> =>
    (await readdir(keychain).catch(() => []))
      .map((file) => decodeURIComponent(file.replace(/\.bin$/u, '')))
      .sort();

  // `texto`'s three kinds of secret, and the neighbours a prefix match would wrongly reach:
  // `texto-extra` begins with `texto`, `textos` too, and `recipe:texto` is a recipe's.
  const TEXTO = [
    credentialAccount('texto', 'api.token'),
    signinAccount('texto', 'conta'),
    signinClientAccount('texto', 'conta'),
  ];
  const NEIGHBOURS = [
    credentialAccount('texto-extra', 'api.token'),
    signinAccount('texto-extra', 'conta'),
    signinClientAccount('texto-extra', 'conta'),
    credentialAccount('textos', 'k'),
    signinAccount('outro', 'texto'),
    'recipe:texto',
  ];

  async function seed(): Promise<void> {
    for (const account of [...TEXTO, ...NEIGHBOURS]) await credentials.set(account, 'segredo');
  }

  async function installedTexto(): Promise<void> {
    await manager({ picked: await pluginFolder() }).plugins.install('folder');
  }

  function removing(forget: boolean) {
    return manager({
      confirmRemove: () => Promise.resolve({ remove: true, forget }),
      forgetSecrets: (name) => forgetPluginSecrets(credentials, name),
    }).plugins;
  }

  it("deletes the plugin's three kinds of entry and nothing of a plugin whose name begins the same", async () => {
    await seed();
    expect(await onDisk()).toEqual([...TEXTO, ...NEIGHBOURS].sort());

    expect(await forgetPluginSecrets(credentials, 'texto')).toEqual([...TEXTO].sort());

    expect(await onDisk()).toEqual([...NEIGHBOURS].sort());
    // And again: nothing left to forget is not an error.
    expect(await forgetPluginSecrets(credentials, 'texto')).toEqual([]);
  });

  it('a ticked remove leaves a reinstall nothing to find', async () => {
    await installedTexto();
    await seed();

    expect((await removing(true).change('texto', 'remove')).status).toBe('changed');
    expect(await installedFolders()).toEqual([]);
    expect(await onDisk()).toEqual([...NEIGHBOURS].sort());

    await installedTexto();
    for (const account of TEXTO) expect(await credentials.has(account), account).toBe(false);
  });

  it('an unticked remove leaves a reinstall everything, byte for byte', async () => {
    await installedTexto();
    await seed();
    const before = await Promise.all(
      TEXTO.map((account) =>
        readFile(join(keychain, `${encodeURIComponent(account)}.bin`), 'utf8'),
      ),
    );

    expect((await removing(false).change('texto', 'remove')).status).toBe('changed');
    expect(await installedFolders()).toEqual([]);
    expect(await onDisk()).toEqual([...TEXTO, ...NEIGHBOURS].sort());

    await installedTexto();
    for (const account of TEXTO) expect(await credentials.get(account), account).toBe('segredo');
    const after = await Promise.all(
      TEXTO.map((account) =>
        readFile(join(keychain, `${encodeURIComponent(account)}.bin`), 'utf8'),
      ),
    );
    expect(after).toEqual(before);
  });
});
