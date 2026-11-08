import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { permissionPrompt } from '@tyto/command-line';
import { PLUGIN_API_VERSION, type PluginManifest } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { translate } from '../../shared/i18n/index.js';
import {
  type ManageBox,
  type PluginManagerOptions,
  approveInstallInABox,
  confirmRemoveInABox,
  createPluginManager,
} from './plugin-manage.js';

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
function box(response: number): {
  shown: ManageBox[];
  show: (shown: ManageBox) => Promise<{ response: number }>;
} {
  const shown: ManageBox[] = [];
  return {
    shown,
    show: (item) => {
      shown.push(item);
      return Promise.resolve({ response });
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
      return Promise.resolve(true);
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
    expect(await confirmRemoveInABox(dismissed.show, say)('pdf')).toBe(false);
    expect(dismissed.shown[0]).toMatchObject({
      type: 'warning',
      message: "Remove 'pdf'?",
      buttons: ['Remove', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    expect(await confirmRemoveInABox(box(0).show, say)('pdf')).toBe(true);
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
