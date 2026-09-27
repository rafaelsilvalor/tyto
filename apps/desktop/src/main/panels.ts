import {
  type HostCapabilities,
  type HostFetchInit,
  PluginCapabilityError,
  checkedCapabilities,
} from '@tyto/plugin-api';
import { z } from 'zod';

import { panelUrl } from './plugin-protocol.js';
import type { WindowPlugins } from './window-plugins.js';

/**
 * The installed plugins' panels, as the window lists them, and what a panel may ask of the
 * host (TYTO-49, ADR 0045).
 *
 * **The same permissions as the plugin's own `host.fetch` and `host.credentials`**, checked
 * here in main by the same `checkedCapabilities`, against the manifest the host validated —
 * never in the renderer, which relays, and never in the page, which is somebody else's code.
 * A panel is its plugin: it gets no permission its plugin was not granted, and none of
 * another plugin's.
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
    capability: 'fetch' | 'credentials',
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

  return {
    async list() {
      await plugins.ready;
      return offered();
    },

    async request(panelId, capability, args) {
      const panel = offered().find((candidate) => candidate.id === panelId);
      const permissions = panel === undefined ? undefined : plugins.permissionsOf(panel.plugin);
      if (panel === undefined || permissions === undefined) {
        return { ok: false, code: 'E_PERMISSION', message: `No panel '${panelId}' is open.` };
      }
      const checked = checkedCapabilities(panel.plugin, permissions, capabilities);
      try {
        if (capability === 'credentials') {
          const parsed = credentialArgs.safeParse(args);
          if (!parsed.success) throw new TypeError('host.credentials takes one key.');
          return { ok: true, value: await checked.credentials(parsed.data[0]) };
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
