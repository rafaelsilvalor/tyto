import {
  type HostCapabilities,
  type HostFetchInit,
  PluginCapabilityError,
  callPanel,
  checkedCapabilities,
} from '@tyto/plugin-api';
import { z } from 'zod';

import type { PanelCapability } from '../../shared/ipc.js';
import { panelUrl } from './plugin-protocol.js';
import type { WindowPanel, WindowPlugins } from './window-plugins.js';

/**
 * The installed plugins' panels, as the window lists them, and what a panel may ask of the
 * host (TYTO-49, ADR 0045).
 *
 * **The same permissions as the plugin's own `host.fetch` and `host.credentials`**, checked
 * here in main by the same `checkedCapabilities`, against the manifest the host validated —
 * never in the renderer, which relays, and never in the page, which is somebody else's code.
 * A panel is its plugin: it gets no permission its plugin was not granted, and none of
 * another plugin's.
 *
 * **`call` reaches the panel's own plugin and no other** (ADR 0173). The panel is found from
 * the layout id the renderer read off the iframe's element — plugin and panel both, since two
 * plugins may each name a panel `settings` — and never from anything the page wrote; the
 * request itself is checked by `callPanel`, whose strict schema refuses a `plugin` or `panel`
 * key the page adds.
 */

/** The layout id of a plugin's panel — prefixed, so it can never collide with a built-in. */
export const PLUGIN_PANEL_PREFIX = 'plugin:';

export function pluginPanelId(plugin: string, panel: string): string {
  return `${PLUGIN_PANEL_PREFIX}${plugin}/${panel}`;
}

export interface OfferedPanel {
  readonly id: string;
  readonly plugin: string;
  readonly title: string;
  readonly location?: 'left' | 'right' | 'bottom';
  /** The iframe's `src`, a `tyto-plugin:` URL main serves out of the plugin's folder. */
  readonly src: string;
}

export type PanelAnswer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string };

export interface PanelService {
  /** Waits for the plugins to have started, so the list is whole the first time. */
  list(): Promise<readonly OfferedPanel[]>;
  request(
    panelId: string,
    capability: PanelCapability,
    args: readonly unknown[],
  ): Promise<PanelAnswer>;
}

const fetchArgs = z.union([
  z.tuple([z.string()]),
  z.tuple([
    z.string(),
    z.strictObject({
      method: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.string().optional(),
    }),
  ]),
]);
const credentialArgs = z.tuple([z.string().min(1)]);
const storeCredentialArgs = z.tuple([z.string().min(1), z.string()]);

export function createPanelService(
  plugins: WindowPlugins,
  capabilities: HostCapabilities,
): PanelService {
  const offered = (): OfferedPanel[] =>
    plugins.panels().map(({ plugin, panel }) => ({
      id: pluginPanelId(plugin, panel.id),
      plugin,
      title: panel.title,
      ...(panel.location === undefined ? {} : { location: panel.location }),
      src: panelUrl(plugin, panel.entry),
    }));

  /**
   * The panel behind a layout id, matched on plugin and panel id together: two plugins may
   * each name a panel `settings`, and a bare panel id would answer with the first one's.
   */
  const contributed = (panelId: string): WindowPanel | undefined =>
    plugins.panels().find(({ plugin, panel }) => pluginPanelId(plugin, panel.id) === panelId);

  return {
    async list() {
      await plugins.ready;
      return offered();
    },

    async request(panelId, capability, args) {
      const panel = contributed(panelId);
      const permissions = panel === undefined ? undefined : plugins.permissionsOf(panel.plugin);
      if (panel === undefined || permissions === undefined) {
        return { ok: false, code: 'E_PERMISSION', message: `No panel '${panelId}' is open.` };
      }
      const checked = checkedCapabilities(panel.plugin, permissions, capabilities);
      try {
        // `[method, params?]`: the method's pattern, the sizes and the shape are callPanel's
        // to refuse, as E_PANEL_CALL, before the plugin sees anything.
        if (capability === 'call') {
          const [method, params] = args;
          return answerOf(await callPanel(panel.panel, { method, params }, panel.plugin));
        }
        if (capability === 'credentials') {
          const parsed = credentialArgs.safeParse(args);
          if (!parsed.success) throw new TypeError('host.credentials takes one key.');
          return { ok: true, value: await checked.credentials(parsed.data[0]) };
        }
        // A panel stores and forgets its own plugin's declared keys, through the one check
        // the plugin's process goes through (ADR 0134); the size and the empty value are its.
        if (capability === 'storeCredential') {
          const parsed = storeCredentialArgs.safeParse(args);
          if (!parsed.success) throw new TypeError('host.credentials.set takes a key and a value.');
          await checked.storeCredential(parsed.data[0], parsed.data[1]);
          return { ok: true, value: null };
        }
        if (capability === 'deleteCredential') {
          const parsed = credentialArgs.safeParse(args);
          if (!parsed.success) throw new TypeError('host.credentials.delete takes one key.');
          return { ok: true, value: await checked.deleteCredential(parsed.data[0]) };
        }
        const parsed = fetchArgs.safeParse(args);
        if (!parsed.success) throw new TypeError('host.fetch takes a URL and an optional init.');
        const [url, init] = parsed.data as [string, HostFetchInit | undefined];
        const response = await checked.fetch(url, init);
        // Text and not bytes: a panel is a page, and what it reads it reads as a string.
        return {
          ok: true,
          value: {
            url: response.url,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            body: new TextDecoder().decode(response.body),
          },
        };
      } catch (cause) {
        if (cause instanceof PluginCapabilityError) {
          return { ok: false, code: cause.code, message: cause.message };
        }
        return {
          ok: false,
          code: 'E_PLUGIN_CALL',
          message: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
  };
}

/** A call's result as the bridge answers it: every diagnostic's message, the first's code. */
function answerOf(result: Awaited<ReturnType<typeof callPanel>>): PanelAnswer {
  if (result.ok) return { ok: true, value: result.value };
  const [first] = result.error;
  return {
    ok: false,
    code: first?.code ?? 'E_PANEL_CALL',
    message: result.error.map((problem) => problem.message).join(' '),
  };
}
