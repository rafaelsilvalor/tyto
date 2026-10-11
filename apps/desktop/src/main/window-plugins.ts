import type { DirectiveResolver } from '@tyto/core';
import {
  type BrandKits,
  type EditorKeymap,
  type LoadedPlugins,
  type PanelContribution,
  type ThemeContribution,
  createPluginHost,
  directiveNamesOf,
  directiveResolverOf,
  validatePluginManifest,
} from '@tyto/plugin-api';

/**
 * What the installed plugins contribute to the window itself (TYTO-49, ADR 0043, ADR 0045).
 *
 * An export builds a host per run and activates the installed plugins into it, so a run
 * resolves through that host. The preview and the panels have no such host — the preview
 * compiles on every keystroke and binds no exporter, and a panel lives as long as the window
 * — so they read this one: activated once, when the plugins have started, and holding only
 * what they registered. An installed exporter's refusals are the export's to report, and
 * this host is never asked for one.
 *
 * Until the plugins have started it offers nothing, so a `::demo/shout` typed in the first
 * second is `E_UNKNOWN_DIRECTIVE` and the next preview after start-up clears it; the window
 * opening is not made to wait on a plugin's activation (ADR 0044). `ready` is for the one
 * question that has to wait, which panels exist.
 */
export interface WindowPlugins {
  readonly resolver: DirectiveResolver;
  /** `namespace/name`, for completion after `::`. */
  names(): readonly string[];
  /** Settles when the plugins have started and been activated here. Never rejects. */
  readonly ready: Promise<void>;
  /** Every panel, with the plugin that registered it. Empty until `ready`. */
  panels(): readonly WindowPanel[];
  /** Every `editor.keymap`, in activation order, with its plugin. Empty until `ready`. */
  keymaps(): readonly WindowKeymap[];
  /** Every colour theme, with its plugin (TYTO-208, ADR 0077). Empty until `ready`. */
  themes(): readonly WindowTheme[];
  /** The permissions the host validated for a plugin, or `undefined` for one it has not. */
  permissionsOf(plugin: string): readonly string[] | undefined;
  /**
   * The installed plugins' brand kits, one per brand (ADR 0063), and the warnings the merge
   * made. Empty until the plugins have started, like the directives.
   */
  brandKits(): BrandKits;
}

export interface WindowPanel {
  readonly plugin: string;
  readonly panel: PanelContribution;
}

export interface WindowKeymap {
  readonly plugin: string;
  readonly keymap: EditorKeymap;
}

export interface WindowTheme {
  readonly plugin: string;
  readonly theme: ThemeContribution;
}

export function windowPlugins(plugins: Promise<LoadedPlugins>): WindowPlugins {
  const host = createPluginHost();
  const owned: WindowPanel[] = [];
  const keymaps: WindowKeymap[] = [];
  const themes: WindowTheme[] = [];
  const permissions = new Map<string, readonly string[]>();
  let started = false;

  const ready = plugins.then(
    (loaded) => {
      for (const plugin of loaded.plugins) {
        const before = new Set(host.registry.panels());
        const keymapsBefore = new Set(host.registry.keymaps());
        const themesBefore = new Set(host.registry.themes());
        // A plugin this host refuses is refused by the export too, where the run reports it;
        // saying it twice on every keystroke would bury the one that matters.
        const activated = host.tryActivate(plugin, 'external');
        if (!activated.ok) continue;
        const manifest = validatePluginManifest(plugin.manifest);
        permissions.set(plugin.id, manifest.ok ? manifest.value.permissions : []);
        for (const panel of host.registry.panels()) {
          if (!before.has(panel)) owned.push({ plugin: plugin.id, panel });
        }
        for (const keymap of host.registry.keymaps()) {
          if (!keymapsBefore.has(keymap)) keymaps.push({ plugin: plugin.id, keymap });
        }
        for (const theme of host.registry.themes()) {
          if (!themesBefore.has(theme)) themes.push({ plugin: plugin.id, theme });
        }
      }
      started = true;
    },
    () => {
      started = true;
    },
  );

  const directives = () => (started ? host.registry.directives() : []);
  const noKits: BrandKits = { kits: new Map(), diagnostics: [] };
  return {
    resolver: directiveResolverOf(directives),
    names: () => directiveNamesOf(directives()),
    ready,
    // Filtered against the registry, so a panel its plugin withdrew is not offered again.
    panels: () => owned.filter(({ panel }) => host.registry.panels().includes(panel)),
    keymaps: () => keymaps.filter(({ keymap }) => host.registry.keymaps().includes(keymap)),
    themes: () => themes.filter(({ theme }) => host.registry.themes().includes(theme)),
    permissionsOf: (plugin) => permissions.get(plugin),
    brandKits: () => (started ? host.registry.brandKitsByBrand() : noKits),
  };
}
