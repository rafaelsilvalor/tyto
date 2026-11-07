import type { DirectiveResolver } from '@tyto/core';
import {
  type AssetSourceContribution,
  type BrandKits,
  type DeclaredSetting,
  type EditorKeymap,
  type EditorVimContribution,
  type FontSourceContribution,
  type InProcessHost,
  type LoadedPlugins,
  NO_PLUGINS,
  type OwnedSource,
  type PanelContribution,
  type Plugin,
  type RecipeContributions,
  type ThemeContribution,
  createPluginHost,
  directiveNamesOf,
  directiveResolverOf,
  validatePluginManifest,
} from '@tyto/plugin-api';

/**
 * What the installed plugins contribute to the window itself (TYTO-49, ADR 0043, ADR 0045),
 * and the plugins the plugin files fetched beside them (TYTO-466): one host for both sets, so
 * a fetched plugin reaches every extension point an installed one does, through one path.
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
  /** Every `editor.vim`, in activation order, with its plugin (TYTO-418). Empty until `ready`. */
  vim(): readonly WindowVim[];
  /** Every colour theme, with its plugin (TYTO-208, ADR 0077). Empty until `ready`. */
  themes(): readonly WindowTheme[];
  /** The permissions the host validated for a plugin, or `undefined` for one it has not. */
  permissionsOf(plugin: string): readonly string[] | undefined;
  /**
   * The installed plugins' brand kits, one per brand (ADR 0063), and the warnings the merge
   * made. Empty until the plugins have started, like the directives.
   */
  brandKits(): BrandKits;
  /**
   * The installed plugins' `asset-source` and `font-source` (ADR 0117), which the preview asks
   * through the app's source cache. Empty until the plugins have started.
   */
  assetSources(): readonly OwnedSource<AssetSourceContribution>[];
  fontSources(): readonly OwnedSource<FontSourceContribution>[];
  /**
   * The settings the installed plugins declared, prefixed with their ids (TYTO-254, ADR 0145).
   * Empty until the plugins have started, like the directives.
   */
  configurations(): readonly DeclaredSetting[];
  /**
   * Hands the installed plugins their settings: each plugin's process is sent its slice
   * (`InProcessHost.configure`, protocol 7). Before they have started, the slice is held and sent
   * when each is activated here.
   */
  configure(config: Readonly<Record<string, unknown>>): void;
  /** The ids of the plugins activated here — the ones running. Empty until `ready`. */
  running(): readonly string[];
  /**
   * The installed plugins' recipe verbs and derivations (ADR 0135), which the recipe notebook
   * runs (TYTO-377, ADR 0148). Read per call, so a verb is found once the plugins have started
   * and a withdrawn one stops answering. Empty until they have started, like the directives:
   * a recipe run in the first second names its plugin's verbs as unknown, and the next run
   * after start-up finds them.
   */
  recipeContributions(): RecipeContributions;
  /**
   * Hands over the fetched set (TYTO-466), or `undefined` when none loads: every contribution
   * of the previous one is withdrawn and the new one's are offered, fetched before installed.
   * Before the installed plugins have started it is kept for the activation at `ready`.
   */
  setFetched(fetched: FetchedPlugins | undefined): void;
  /** The folder of a fetched plugin's copy, or `undefined` for a plugin that is not one. */
  fetchedDirectory(plugin: string): string | undefined;
  /**
   * The plugins an export activates into its run's host, in this window's order (fetched
   * first), once the installed plugins have started.
   */
  inForce(): Promise<LoadedPlugins>;
}

export interface WindowPanel {
  readonly plugin: string;
  readonly panel: PanelContribution;
}

export interface WindowKeymap {
  readonly plugin: string;
  readonly keymap: EditorKeymap;
}

export interface WindowVim {
  readonly plugin: string;
  readonly contribution: EditorVimContribution;
}

export interface WindowTheme {
  readonly plugin: string;
  readonly theme: ThemeContribution;
}

/**
 * The plugins the plugin files fetched (TYTO-433, ADR 0151), as their own set: started again
 * whenever a sync changes which copies load, and handed here each time.
 */
export interface FetchedPlugins {
  readonly loaded: LoadedPlugins;
  /** The folder of a fetched plugin's copy, which its panel pages and themes are read from. */
  directoryOf(plugin: string): string | undefined;
}

const NO_FETCHED: FetchedPlugins = { loaded: NO_PLUGINS, directoryOf: () => undefined };

/** One activation of every plugin in force into a host of its own, and what each one added. */
interface Activation {
  readonly host: InProcessHost;
  readonly panels: readonly WindowPanel[];
  readonly keymaps: readonly WindowKeymap[];
  readonly vim: readonly WindowVim[];
  readonly themes: readonly WindowTheme[];
  readonly permissions: ReadonlyMap<string, readonly string[]>;
  readonly ids: readonly string[];
}

function activateInto(
  plugins: readonly Plugin[],
  config: Readonly<Record<string, unknown>> | undefined,
): Activation {
  const host = createPluginHost();
  // Before any activation, so a plugin's process is sent its slice as it is activated.
  if (config !== undefined) host.configure(config);
  const panels: WindowPanel[] = [];
  const keymaps: WindowKeymap[] = [];
  const vim: WindowVim[] = [];
  const themes: WindowTheme[] = [];
  const permissions = new Map<string, readonly string[]>();
  const ids: string[] = [];
  for (const plugin of plugins) {
    const before = new Set(host.registry.panels());
    const keymapsBefore = new Set(host.registry.keymaps());
    const vimBefore = new Set(host.registry.vim());
    const themesBefore = new Set(host.registry.themes());
    // A plugin this host refuses is refused by the export too, where the run reports it;
    // saying it twice on every keystroke would bury the one that matters.
    const activated = host.tryActivate(plugin, 'external');
    if (!activated.ok) continue;
    ids.push(plugin.id);
    const manifest = validatePluginManifest(plugin.manifest);
    permissions.set(plugin.id, manifest.ok ? manifest.value.permissions : []);
    for (const panel of host.registry.panels()) {
      if (!before.has(panel)) panels.push({ plugin: plugin.id, panel });
    }
    for (const keymap of host.registry.keymaps()) {
      if (!keymapsBefore.has(keymap)) keymaps.push({ plugin: plugin.id, keymap });
    }
    for (const contribution of host.registry.vim()) {
      if (!vimBefore.has(contribution)) vim.push({ plugin: plugin.id, contribution });
    }
    for (const theme of host.registry.themes()) {
      if (!themesBefore.has(theme)) themes.push({ plugin: plugin.id, theme });
    }
  }
  return { host, panels, keymaps, vim, themes, permissions, ids };
}

/**
 * The plugins in force, in the order they are activated: **the fetched ones first, then the
 * installed ones no fetched copy replaces** (ADR 0151 decision 7). A host refuses a
 * contribution id another plugin already holds, so the earlier plugin keeps it, as the
 * template search order says; and an installed plugin named like a fetched one is not
 * activated at all.
 */
export function pluginsInForce(
  fetched: readonly Plugin[],
  installed: readonly Plugin[],
): readonly Plugin[] {
  const replaced = new Set(fetched.map((plugin) => plugin.id));
  return [...fetched, ...installed.filter((plugin) => !replaced.has(plugin.id))];
}

export function windowPlugins(plugins: Promise<LoadedPlugins>): WindowPlugins {
  let installed: readonly Plugin[] = [];
  let fetched = NO_FETCHED;
  let config: Readonly<Record<string, unknown>> | undefined;
  let current = activateInto([], undefined);
  let started = false;

  /**
   * One host per set of plugins in force, built again whole when the fetched set changes:
   * activation order is precedence, and a fetched plugin activated after the installed ones
   * would lose every id they hold. The previous host's contributions are withdrawn, so nothing
   * it offered (a panel, a key, a theme) is read again.
   */
  const rebuild = (): void => {
    const previous = current;
    current = activateInto(pluginsInForce(fetched.loaded.plugins, installed), config);
    for (const id of previous.ids) previous.host.disposePlugin(id);
  };

  const ready = plugins
    .then(
      (loaded) => {
        installed = loaded.plugins;
      },
      () => undefined,
    )
    .then(() => {
      rebuild();
      started = true;
    });

  const registry = () => current.host.registry;
  const directives = () => (started ? registry().directives() : []);
  const noKits: BrandKits = { kits: new Map(), diagnostics: [] };
  const recipes: RecipeContributions = {
    recipeVerbs: () => (started ? registry().recipeVerbs() : []),
    ownedRecipeVerbs: () => (started ? registry().ownedRecipeVerbs() : []),
    recipeDerivations: () => (started ? registry().recipeDerivations() : []),
  };
  return {
    resolver: directiveResolverOf(directives),
    names: () => directiveNamesOf(directives()),
    ready,
    // Filtered against the registry, so a panel its plugin withdrew is not offered again.
    panels: () => current.panels.filter(({ panel }) => registry().panels().includes(panel)),
    keymaps: () => current.keymaps.filter(({ keymap }) => registry().keymaps().includes(keymap)),
    vim: () => current.vim.filter(({ contribution }) => registry().vim().includes(contribution)),
    themes: () => current.themes.filter(({ theme }) => registry().themes().includes(theme)),
    permissionsOf: (plugin) => current.permissions.get(plugin),
    brandKits: () => (started ? registry().brandKitsByBrand() : noKits),
    assetSources: () => (started ? registry().assetSources() : []),
    fontSources: () => (started ? registry().fontSources() : []),
    configurations: () => (started ? registry().configurations() : []),
    configure: (next) => {
      config = next;
      current.host.configure(next);
    },
    running: () => (started ? current.ids : []),
    recipeContributions: () => recipes,
    setFetched: (next) => {
      fetched = next ?? NO_FETCHED;
      // Before start-up the set is only kept: the activation at `ready` takes it.
      if (started) rebuild();
    },
    fetchedDirectory: (plugin) =>
      fetched.loaded.plugins.some((candidate) => candidate.id === plugin)
        ? fetched.directoryOf(plugin)
        : undefined,
    inForce: async () => {
      await ready;
      return {
        plugins: pluginsInForce(fetched.loaded.plugins, installed),
        warnings: [],
        // Each set closes its own processes; an export only activates them.
        close: () => Promise.resolve(),
      };
    },
  };
}
