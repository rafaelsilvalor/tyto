import {
  type BrandKit,
  type Diagnostic,
  type Diagnostics,
  type Result,
  diagnostic,
  err,
  isErr,
  ok,
} from '@tyto/core';
import type { ZodType } from 'zod';

import type {
  BrandKitContribution,
  DirectiveContribution,
  EditorCommand,
  EditorKeymap,
  EditorVimContribution,
  Exporter,
  ExporterRegistry,
  PanelContribution,
  Provided,
  TemplatePack,
} from './contributions.js';
import {
  type HostCache,
  type HostCapabilities,
  type HostCredentials,
  type HostFetchInit,
  type HostFetchResponse,
  type HostWorkspace,
  checkedCapabilities,
  hostCache,
  hostCredentials,
  hostWorkspace,
  responseOf,
} from './capabilities.js';
import { type DeclaredSetting, type SettingDeclaration, declaredSetting } from './configuration.js';
import { type ContributionPoint, type PluginManifest, validatePluginManifest } from './manifest.js';
import {
  type RecipeContributions,
  type RecipeDeclarations,
  type RecipeDerivationContribution,
  type RecipeVerbContribution,
  checkRecipeDerivation,
  checkRecipeVerb,
} from './recipes.js';
import {
  type AssetSourceContribution,
  type FontSourceContribution,
  type OwnedSource,
  SOURCE_SCHEME,
} from './sources.js';
import { type ThemeContribution, checkThemeContribution } from './theme.js';

/**
 * `PluginHost` and the in-process implementation of it (`docs/plugin-api.md`, Phase 1).
 *
 * Phase 1 is deliberately the boring half: no loader, no permissions, no isolation. What it
 * does is route **every built-in through the same door a third party will use**, which is
 * the only way to find out whether that door works before opening it. A registry that only
 * ever held third-party plugins would be a registry whose first real user was a stranger.
 *
 * Pure, like the rest of this package: the host is maps and disposables, and every
 * capability it hands out — a logger, a config schema — arrives from the composition root.
 */

export interface Disposable {
  dispose(): void;
}

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

export interface HostEvents {
  /** A contribution reached the host. `point` is the extension point's name. */
  registered: { readonly point: string; readonly id: string };
  /** A contribution was withdrawn, by its own `dispose` or by its plugin's. */
  disposed: { readonly point: string; readonly id: string };
  /**
   * The configuration `config()` reads was replaced (`InProcessHost.configure`): read it again.
   * How an isolated plugin's proxy learns to send its process the new values (ADR 0145).
   */
  configured: Readonly<Record<string, never>>;
}

export type HostEventListener<Event extends keyof HostEvents> = (
  payload: HostEvents[Event],
) => void;

export interface TypedEmitter {
  on<Event extends keyof HostEvents>(event: Event, listener: HostEventListener<Event>): Disposable;
  emit<Event extends keyof HostEvents>(event: Event, payload: HostEvents[Event]): void;
}

/**
 * What a plugin receives.
 *
 * Every `register*` returns a `Disposable`, so a plugin can withdraw one contribution
 * without being unloaded, and unloading is the same operation applied to all of them.
 */
export interface PluginHost {
  registerExporter(exporter: Exporter): Disposable;
  registerSource<T>(contribution: Provided<T>): Disposable;
  registerSink<T>(contribution: Provided<T>): Disposable;
  registerRasterizer<T>(contribution: Provided<T>): Disposable;
  registerTemplatePack(pack: TemplatePack): Disposable;
  registerBrandKit(kit: BrandKitContribution): Disposable;
  registerDirective(directive: DirectiveContribution): Disposable;
  registerCommand(command: EditorCommand): Disposable;
  registerKeymap(keymap: EditorKeymap): Disposable;
  /** Vim mappings and ex commands, as data the window applies (ADR 0141). */
  registerVim(contribution: EditorVimContribution): Disposable;
  registerPanel(panel: PanelContribution): Disposable;
  /**
   * A setting the person can write in the settings file (ADR 0073). The key the file uses is
   * `<plugin id>.<id>`, or `id` alone for a built-in. Declared with a Zod `schema`, or with a
   * `form` — the data an isolated plugin sends instead, since a schema does not cross (ADR 0145).
   */
  registerConfiguration<T>(setting: SettingDeclaration<T>): Disposable;
  /**
   * A colour theme: a JSON file inside the plugin's folder the window can apply (ADR 0077).
   * Data only, so an installed plugin may contribute one.
   */
  registerTheme(theme: ThemeContribution): Disposable;
  /** Images behind one or more URI schemes, fetched once and cached by the host (ADR 0117). */
  registerAssetSource(source: AssetSourceContribution): Disposable;
  /** Faces of the families it names, for a face no local folder has (ADR 0117). */
  registerFontSource(source: FontSourceContribution): Disposable;
  /**
   * A recipe verb, named `<namespace>.<verb>` in the namespace the manifest declares
   * (ADR 0135). An action or a sink declares `writes`, a subset of the manifest's.
   */
  registerRecipeVerb(verb: RecipeVerbContribution): Disposable;
  /** A derivation for `derive`, named `<namespace>.<name>` (ADR 0133, ADR 0135). */
  registerRecipeDerivation(derivation: RecipeDerivationContribution): Disposable;

  /**
   * The plugin's own configuration, validated.
   *
   * For a plugin that declared settings, this is the record of them by its own keys, with
   * every key present: what the file said where the schema accepted it, the default where it
   * did not (`InProcessHost.configure`). Read it when needed rather than once at activation.
   *
   * A schema rather than a shape, because a plugin's config arrives as JSON somebody typed
   * and "it parsed" is not the same as "it is what this plugin needs". Throws on a
   * mismatch: a plugin activating against configuration it cannot use should stop there
   * rather than half-work.
   */
  config<T>(schema: ZodType<T>): T;

  /**
   * The network, for the hosts the manifest declares (`net:<host>`, `net:*.<domain>`,
   * `net:*`). Anything else rejects with a `PluginCapabilityError` whose `code` is
   * `E_PERMISSION`. Redirects are not followed: the 3xx comes back, and the next request is
   * checked like the first (ADR 0042).
   */
  fetch(url: string, init?: HostFetchInit): Promise<HostFetchResponse>;
  /**
   * A secret, for a key the manifest declares as `credentials:<key>`. An undeclared key
   * rejects with `E_PERMISSION`, and a declared one this host holds no value for with
   * `E_CREDENTIAL_MISSING`. `credentials.set(key, value)` stores one and
   * `credentials.delete(key)` forgets one, under the same permission; a value over 16 KiB
   * is `E_CREDENTIAL_TOO_LARGE`, and a host whose secrets only read (the CLI) answers
   * either with `E_CREDENTIAL_READ_ONLY` (ADR 0134).
   */
  readonly credentials: HostCredentials;
  /**
   * The plugin's private cache, kept by the host outside every workspace and dated by its
   * clock (ADR 0138). No permission: it holds only what this plugin put there. A key is a
   * non-empty string of at most 1 KiB in UTF-8 and an entry at most 32 MiB; either refused,
   * or a host with no cache, is `E_PLUGIN_CACHE`.
   */
  readonly cache: HostCache;
  /**
   * The open folder's files, at a path relative to it (ADR 0138), behind `workspace:read` and
   * `workspace:write`. A path that leaves the folder, a write into `.tyto/`, a file over
   * 32 MiB or no folder open is `E_WORKSPACE_FILE`; a restricted folder is
   * `E_WORKSPACE_FILE_RESTRICTED`.
   */
  readonly workspace: HostWorkspace;

  readonly log: Logger;
  readonly events: TypedEmitter;
}

/**
 * Where a plugin came from, which is the one thing `tyto plugin list` shows that the
 * manifest cannot say about itself: a manifest is written by its author, and an author has
 * no way to know whether their plugin ended up bundled or installed.
 *
 * `external` is what `tryActivate` records by default: a plugin the loader found under
 * `plugins/` (E11.1).
 */
export type PluginOrigin = 'built-in' | 'external';

/** A plugin the host has activated: its validated manifest, and where it came from. */
export interface InstalledPlugin {
  readonly manifest: PluginManifest;
  readonly origin: PluginOrigin;
}

/** What the composition root reads back out. The plugins never see this half. */
export interface PluginRegistry extends RecipeContributions {
  /** Every activated plugin, in activation order — what `tyto plugin list` prints. */
  plugins(): readonly InstalledPlugin[];
  readonly exporters: ExporterRegistry;
  sources<T>(): readonly Provided<T>[];
  sinks<T>(): readonly Provided<T>[];
  rasterizers<T>(): readonly Provided<T>[];
  templatePacks(): readonly TemplatePack[];
  /** Every kit contribution, in registration order. */
  brandKits(): readonly BrandKitContribution[];
  /**
   * The kits merged by brand id (ADR 0063) — what `compile`'s `brandKits` takes. The plugin
   * registered first keeps a brand, and each kit it hid is a `W_BRAND_KIT_SHADOWED`.
   */
  brandKitsByBrand(): BrandKits;
  directives(): readonly DirectiveContribution[];
  commands(): readonly EditorCommand[];
  keymaps(): readonly EditorKeymap[];
  /** Every vim contribution, in registration order: built-ins first (ADR 0141). */
  vim(): readonly EditorVimContribution[];
  panels(): readonly PanelContribution[];
  /** Every declared setting, in registration order, by the key a settings file uses. */
  configurations(): readonly DeclaredSetting[];
  /** Every colour theme, in registration order: built-ins first (ADR 0077). */
  themes(): readonly ThemeContribution[];
  /** Every asset source with its plugin, in registration order: earlier wins a scheme. */
  assetSources(): readonly OwnedSource<AssetSourceContribution>[];
  /** Every font source with its plugin, in registration order: earlier wins a family. */
  fontSources(): readonly OwnedSource<FontSourceContribution>[];
}

/** The kits of every plugin merged into one per brand, and the warnings the merge made. */
export interface BrandKits {
  readonly kits: ReadonlyMap<string, BrandKit>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface PluginHostOptions {
  /** Defaults to a logger that drops everything, so a test is not a wall of output. */
  readonly log?: Logger;
  /** Raw configuration, by plugin id. `config()` validates a slice of it. */
  readonly config?: Readonly<Record<string, unknown>>;
  /**
   * The network and the secrets `fetch` and `credentials` reach, behind the permission
   * check. Absent for every built-in today: none declares a permission.
   */
  readonly capabilities?: HostCapabilities;
}

/** A host bound to one plugin, plus the registry the composition root reads. */
export interface InProcessHost {
  /**
   * Validates a plugin's manifest, records it, and runs its `activate`.
   *
   * The door. A caller *could* reach `hostFor` directly and skip the manifest, and that is
   * exactly the shortcut this method exists to make unnecessary: a built-in that activated
   * without a manifest would never exercise the check a loaded plugin cannot avoid.
   *
   * Throws on a manifest that does not validate, on a `name` that disagrees with the
   * plugin's `id`, and on a contribution to a point the manifest did not declare. All
   * three are `TypeError` for the reason the duplicate-id check is: in Phase 1 every
   * plugin is a built-in this repository wired itself, so each is a wiring bug rather than
   * something a brief or a user could cause (`docs/conventions.md`). When the loader
   * arrives (E11.1) it calls {@link parsePluginManifest} first and reports diagnostics,
   * because then the manifest is somebody else's file.
   */
  activate(plugin: Plugin, origin?: PluginOrigin): Disposable | void;
  /**
   * The loader's door (E11.1): the same checks as {@link activate}, answered as data.
   *
   * A plugin somebody installed is somebody else's file and somebody else's code, so every
   * way it can fail to load is an expected error and comes back as diagnostics
   * (`docs/conventions.md`): a manifest that does not validate, a name another plugin
   * already has, a contribution id another plugin already holds, an `activate` that throws,
   * a point it registered into without declaring it. **A plugin that fails is withdrawn
   * whole** — whatever it registered before the failure is disposed — so the run goes on as
   * if it had never been installed, and the plugin that already held the id keeps it.
   *
   * Built-ins stay on `activate`, which throws, because for them each of these is a wiring
   * bug in this repository.
   */
  tryActivate(plugin: Plugin, origin?: PluginOrigin): Result<InstalledPlugin, Diagnostics>;
  /** What one plugin gets. Its `config()` reads that plugin's slice, and nobody else's. */
  hostFor(pluginId: string): PluginHost;
  readonly registry: PluginRegistry;
  /** Withdraws every contribution a plugin made, in one call. */
  disposePlugin(pluginId: string): void;
  /**
   * Replaces the raw configuration `config()` reads, by plugin id — the `config` of
   * `resolveSettings`, once the settings file has been read against the declared settings.
   * Emits `configured`, so an isolated plugin's process receives its new slice (ADR 0145).
   */
  configure(config: Readonly<Record<string, unknown>>): void;
}

const NO_LOG: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface Entry<T> {
  readonly plugin: string;
  readonly value: T;
}

/** A contribution refused because another plugin already holds its id. */
interface Conflict {
  readonly point: ContributionPoint;
  readonly id: string;
  readonly owner: string;
}

type ConflictListener = (conflict: Conflict) => void;

/** One extension point's contributions, keyed by id so a duplicate is a lookup away. */
class Point<T extends { readonly id: string }> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly name: ContributionPoint,
    private readonly emitter: TypedEmitter,
    /** Which points each plugin has contributed to, so `activate` can check the manifest. */
    private readonly contributed: Map<string, Set<ContributionPoint>>,
  ) {}

  add(plugin: string, value: T, onConflict?: ConflictListener): Disposable {
    const existing = this.entries.get(value.id);
    if (existing !== undefined && onConflict !== undefined) {
      // The loader's path (`tryActivate`): the plugin keeps running, the contribution is not
      // stored, and the conflict is reported as data once `activate` returns. Nothing is
      // thrown, because a third party's duplicate is an expected error and not ours.
      onConflict({ point: this.name, id: value.id, owner: existing.plugin });
      return { dispose: () => undefined };
    }
    if (existing !== undefined) {
      // Thrown rather than returned. In Phase 1 every plugin is a built-in this repository
      // wired itself, so two `svg` exporters is a wiring bug and not something a brief or
      // a user could cause — the category `docs/conventions.md` reserves `TypeError` for.
      // When external plugins arrive (E11) the loader catches this and reports the plugin
      // that lost, because then it is somebody else's mistake and not ours.
      throw new TypeError(
        `Extension point '${this.name}' already has '${value.id}', registered by plugin ` +
          `'${existing.plugin}'. Two contributions with one id leave no way to say which ` +
          `one runs, so the second is refused rather than silently chosen between.`,
      );
    }

    this.entries.set(value.id, { plugin, value });
    this.contributed.set(plugin, (this.contributed.get(plugin) ?? new Set()).add(this.name));
    this.emitter.emit('registered', { point: this.name, id: value.id });

    let disposed = false;
    return {
      dispose: () => {
        // Idempotent, and it checks identity before deleting: a disposable held past a
        // re-registration must not remove somebody else's contribution.
        if (disposed) return;
        disposed = true;
        if (this.entries.get(value.id)?.value === value) {
          this.entries.delete(value.id);
          this.emitter.emit('disposed', { point: this.name, id: value.id });
        }
      },
    };
  }

  /** In registration order, which `Map` preserves and every caller relies on. */
  list(): readonly T[] {
    return [...this.entries.values()].map((entry) => entry.value);
  }

  /** The same order, with the plugin that registered each: for a warning that names it. */
  owned(): readonly Entry<T>[] {
    return [...this.entries.values()];
  }

  removeAllFrom(plugin: string): void {
    for (const [id, entry] of [...this.entries]) {
      if (entry.plugin !== plugin) continue;
      this.entries.delete(id);
      this.emitter.emit('disposed', { point: this.name, id });
    }
  }
}

/**
 * One kit per brand, from every plugin's contributions in registration order (ADR 0063).
 *
 * **Earlier wins**, which is ADR 0020's rule for templates: built-ins activate before
 * installed plugins, and installed plugins in the order they were loaded. A brand two
 * plugins offer is not an error — nothing is wrong with the run — but it is said once, so
 * "why is this not my logo" has an answer in `result.json`.
 */
function mergeBrandKits(entries: readonly Entry<BrandKitContribution>[]): BrandKits {
  const kits = new Map<string, BrandKit>();
  const owners = new Map<string, string>();
  const diagnostics: Diagnostic[] = [];
  for (const { plugin, value } of entries) {
    for (const [brand, kit] of Object.entries(value.brands)) {
      const used = owners.get(brand);
      if (used !== undefined) {
        diagnostics.push(diagnostic('W_BRAND_KIT_SHADOWED', { brand, shadowed: plugin, used }));
        continue;
      }
      owners.set(brand, plugin);
      kits.set(brand, kit);
    }
  }
  return { kits, diagnostics };
}

/**
 * A scheme a reference could never spell is a wiring mistake, said at registration rather
 * than met as a source that silently answers nothing. A `TypeError`, which `tryActivate`
 * turns into `E_PLUGIN_ACTIVATE` for a plugin somebody installed.
 */
function checkAssetSource(pluginId: string, source: AssetSourceContribution): void {
  const bad = source.schemes.filter((scheme) => !SOURCE_SCHEME.test(scheme));
  if (source.schemes.length === 0 || bad.length > 0) {
    throw new TypeError(
      `Plugin '${pluginId}' registered asset source '${source.id}' with ` +
        (bad.length > 0
          ? `the scheme${bad.length > 1 ? 's' : ''} ${bad.map((scheme) => `'${scheme}'`).join(', ')}`
          : 'no scheme') +
        `. A scheme is two or more lowercase letters, digits, '+', '.' or '-', starting ` +
        `with a letter, and written without its colon.`,
    );
  }
}

function checkFontSource(pluginId: string, source: FontSourceContribution): void {
  if (source.families.length === 0 || source.families.some((family) => family.trim() === '')) {
    throw new TypeError(
      `Plugin '${pluginId}' registered font source '${source.id}' with no family, or an ` +
        `empty one. A font source is asked by family, so it has to name at least one.`,
    );
  }
}

function createEmitter(): TypedEmitter {
  const listeners = new Map<string, Set<(payload: never) => void>>();

  return {
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      set.add(listener as (payload: never) => void);
      return {
        dispose: () => {
          set.delete(listener as (payload: never) => void);
        },
      };
    },
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) {
        // A listener that throws must not take the registration with it: a progress bar
        // with a bug is not a reason for a plugin to fail to load. `pipeline`'s job
        // listener does the same, for the same reason.
        try {
          (listener as unknown as (value: typeof payload) => void)(payload);
        } catch {
          /* the host has no opinion about somebody else's listener */
        }
      }
    },
  };
}

export function createPluginHost(options: PluginHostOptions = {}): InProcessHost {
  const emitter = createEmitter();
  const log = options.log ?? NO_LOG;

  const contributed = new Map<string, Set<ContributionPoint>>();
  const installed = new Map<string, InstalledPlugin>();

  const exporters = new Point<Exporter>('exporter', emitter, contributed);
  const sources = new Point<Provided<unknown>>('source', emitter, contributed);
  const sinks = new Point<Provided<unknown>>('sink', emitter, contributed);
  const rasterizers = new Point<Provided<unknown>>('rasterizer', emitter, contributed);
  const templatePacks = new Point<TemplatePack>('template-pack', emitter, contributed);
  const brandKits = new Point<BrandKitContribution>('brand-kit', emitter, contributed);
  const directives = new Point<DirectiveContribution>('directive', emitter, contributed);
  const commands = new Point<EditorCommand>('editor.command', emitter, contributed);
  const keymaps = new Point<EditorKeymap>('editor.keymap', emitter, contributed);
  const vims = new Point<EditorVimContribution>('editor.vim', emitter, contributed);
  const panels = new Point<PanelContribution>('panel', emitter, contributed);
  // Keyed by the key the file uses, so two plugins' `fontSize` are two entries and a second
  // built-in declaring a key another built-in holds is the ordinary duplicate refusal.
  const configurations = new Point<{ readonly id: string; readonly setting: DeclaredSetting }>(
    'configuration',
    emitter,
    contributed,
  );
  const themes = new Point<ThemeContribution>('theme', emitter, contributed);
  const assetSources = new Point<AssetSourceContribution>('asset-source', emitter, contributed);
  const fontSources = new Point<FontSourceContribution>('font-source', emitter, contributed);
  const recipeVerbs = new Point<RecipeVerbContribution>('recipe-verb', emitter, contributed);
  const recipeDerivations = new Point<RecipeDerivationContribution>(
    'recipe-derivation',
    emitter,
    contributed,
  );
  let rawConfig: Readonly<Record<string, unknown>> | undefined = options.config;

  const points = [
    exporters,
    sources,
    sinks,
    rasterizers,
    templatePacks,
    brandKits,
    directives,
    commands,
    keymaps,
    vims,
    panels,
    configurations,
    themes,
    assetSources,
    fontSources,
    recipeVerbs,
    recipeDerivations,
  ];

  const registry: PluginRegistry = {
    plugins: () => [...installed.values()],
    exporters: {
      forKind: (kind) => exporters.list().find((exporter) => exporter.kinds.includes(kind)),
      list: () => exporters.list(),
    },
    sources: <T>() => sources.list() as readonly Provided<T>[],
    sinks: <T>() => sinks.list() as readonly Provided<T>[],
    rasterizers: <T>() => rasterizers.list() as readonly Provided<T>[],
    templatePacks: () => templatePacks.list(),
    brandKits: () => brandKits.list(),
    brandKitsByBrand: () => mergeBrandKits(brandKits.owned()),
    directives: () => directives.list(),
    commands: () => commands.list(),
    keymaps: () => keymaps.list(),
    vim: () => vims.list(),
    panels: () => panels.list(),
    configurations: () => configurations.list().map((entry) => entry.setting),
    themes: () => themes.list(),
    assetSources: () =>
      assetSources.owned().map((entry) => ({ plugin: entry.plugin, source: entry.value })),
    fontSources: () =>
      fontSources.owned().map((entry) => ({ plugin: entry.plugin, source: entry.value })),
    recipeVerbs: () => recipeVerbs.list(),
    recipeDerivations: () => recipeDerivations.list(),
  };

  /** The plugin already loaded that owns a recipe namespace (ADR 0135). */
  function namespaceOwner(manifest: PluginManifest): InstalledPlugin | undefined {
    if (manifest.namespace === undefined) return undefined;
    return [...installed.values()].find((other) => other.manifest.namespace === manifest.namespace);
  }

  function hostWith(
    pluginId: string,
    onConflict?: ConflictListener,
    permissions: readonly string[] = [],
    origin: PluginOrigin = 'external',
    recipe: RecipeDeclarations = {},
  ): PluginHost {
    // The permissions of the manifest the host validated, never what the plugin says.
    const checked = checkedCapabilities(pluginId, permissions, options.capabilities);
    return {
      registerExporter: (exporter) => exporters.add(pluginId, exporter, onConflict),
      registerSource: (contribution) => sources.add(pluginId, contribution, onConflict),
      registerSink: (contribution) => sinks.add(pluginId, contribution, onConflict),
      registerRasterizer: (contribution) => rasterizers.add(pluginId, contribution, onConflict),
      registerTemplatePack: (pack) => templatePacks.add(pluginId, pack, onConflict),
      registerBrandKit: (kit) => brandKits.add(pluginId, kit, onConflict),
      registerDirective: (directive) => directives.add(pluginId, directive, onConflict),
      registerCommand: (command) => commands.add(pluginId, command, onConflict),
      registerKeymap: (keymap) => keymaps.add(pluginId, keymap, onConflict),
      registerVim: (contribution) => vims.add(pluginId, contribution, onConflict),
      registerPanel: (panel) => panels.add(pluginId, panel, onConflict),
      registerConfiguration: (setting) => {
        const declared = declaredSetting(
          pluginId,
          origin !== 'built-in',
          setting as SettingDeclaration,
        );
        return configurations.add(pluginId, { id: declared.key, setting: declared }, onConflict);
      },
      registerTheme: (theme) => {
        checkThemeContribution(pluginId, theme);
        return themes.add(pluginId, theme, onConflict);
      },
      registerAssetSource: (source) => {
        checkAssetSource(pluginId, source);
        return assetSources.add(pluginId, source, onConflict);
      },
      registerFontSource: (source) => {
        checkFontSource(pluginId, source);
        return fontSources.add(pluginId, source, onConflict);
      },
      registerRecipeVerb: (verb) => {
        checkRecipeVerb(pluginId, recipe, verb);
        return recipeVerbs.add(pluginId, verb, onConflict);
      },
      registerRecipeDerivation: (derivation) => {
        checkRecipeDerivation(pluginId, recipe.namespace, derivation);
        return recipeDerivations.add(pluginId, derivation, onConflict);
      },

      config<T>(schema: ZodType<T>): T {
        const parsed = schema.safeParse(rawConfig?.[pluginId]);
        if (!parsed.success) {
          throw new TypeError(
            `Configuration for plugin '${pluginId}' does not match the schema it asked ` +
              `for: ${parsed.error.issues
                .map((issue) => `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`)
                .join('; ')}`,
          );
        }
        return parsed.data;
      },

      fetch: async (url, init) => responseOf(await checked.fetch(url, init)),
      credentials: hostCredentials(
        (key) => checked.credentials(key),
        (key, value) => checked.storeCredential(key, value),
        (key) => checked.deleteCredential(key),
      ),
      cache: hostCache(checked),
      workspace: hostWorkspace(checked),

      log,
      events: emitter,
    };
  }

  return {
    registry,

    activate(plugin: Plugin, origin: PluginOrigin = 'built-in'): Disposable | void {
      const validated = validatePluginManifest(plugin.manifest);
      if (isErr(validated)) {
        throw new TypeError(
          `Plugin '${plugin.id}' has a tyto-plugin.json the host cannot read: ` +
            `${validated.error.map((issue) => issue.message).join(' ')}`,
        );
      }

      const manifest = validated.value;
      if (manifest.name !== plugin.id) {
        // One identity, not two. The id is what every extension point keys on and what a
        // loader would name a folder; a manifest that disagrees with it leaves `plugin
        // list` printing one name and an error message printing another.
        throw new TypeError(
          `Plugin '${plugin.id}' ships a tyto-plugin.json naming '${manifest.name}'. The ` +
            `manifest's name is the plugin's id, so the two cannot disagree.`,
        );
      }

      const owner = namespaceOwner(manifest);
      if (owner !== undefined) {
        throw new TypeError(
          `Plugin '${plugin.id}' declares the recipe namespace '${String(manifest.namespace)}', ` +
            `which plugin '${owner.manifest.name}' already owns. A namespace is one plugin's.`,
        );
      }

      const result = plugin.activate(
        hostWith(plugin.id, undefined, manifest.permissions, origin, manifest),
      );

      // Checked *after* activation, against what was actually registered. `contributes` is
      // the manifest's promise about which points this plugin touches, and a promise
      // nothing verifies is a comment: the first version of `plugin list` would have shown
      // whatever the file claimed, which is the failure mode the whole card is about.
      //
      // One direction only. Registering into an undeclared point is always wrong — a
      // loader would have granted nothing for it. Declaring a point and not registering is
      // left alone, because `templatePackPlugin` legitimately contributes an empty pack
      // and a conditional contribution is a shape this API has not ruled out.
      const undeclared = [...(contributed.get(plugin.id) ?? [])].filter(
        (point) => !manifest.contributes.includes(point),
      );
      if (undeclared.length > 0) {
        throw new TypeError(
          `Plugin '${plugin.id}' registered into ${undeclared.map((point) => `'${point}'`).join(', ')}, ` +
            `which its tyto-plugin.json does not list under 'contributes'. The manifest is ` +
            `what a loader reads before any of this code runs, so it has to be the truth.`,
        );
      }

      installed.set(plugin.id, { manifest, origin });
      return result;
    },

    tryActivate(plugin: Plugin, origin: PluginOrigin = 'external') {
      const validated = validatePluginManifest(plugin.manifest);
      if (isErr(validated)) return validated;

      const manifest = validated.value;
      if (manifest.name !== plugin.id) {
        return err([
          diagnostic('E_PLUGIN_ACTIVATE', {
            plugin: plugin.id,
            problem: `its tyto-plugin.json names '${manifest.name}', and the name is the id`,
          }),
        ]);
      }

      // Before `activate` runs, and never followed by `disposePlugin`: withdrawing by id
      // here would withdraw the plugin that already has the name.
      const holder = installed.get(plugin.id);
      if (holder !== undefined) {
        return err([
          diagnostic('E_PLUGIN_NAME_TAKEN', { plugin: plugin.id, origin: holder.origin }),
        ]);
      }

      // Before `activate` too: a namespace is the plugin's whole share of the recipe
      // vocabulary, so the one loaded first keeps all of it rather than racing per verb.
      const owner = namespaceOwner(manifest);
      if (owner !== undefined) {
        return err([
          diagnostic('E_PLUGIN_NAMESPACE_TAKEN', {
            plugin: plugin.id,
            namespace: String(manifest.namespace),
            owner: owner.manifest.name,
          }),
        ]);
      }

      const conflicts: Conflict[] = [];
      try {
        plugin.activate(
          hostWith(
            plugin.id,
            (conflict) => conflicts.push(conflict),
            manifest.permissions,
            origin,
            manifest,
          ),
        );
      } catch (cause) {
        // Any throw, whatever its class: this is foreign code, and the question is only
        // whether it finished.
        this.disposePlugin(plugin.id);
        return err([
          diagnostic('E_PLUGIN_ACTIVATE', {
            plugin: plugin.id,
            problem: cause instanceof Error ? cause.message : String(cause),
          }),
        ]);
      }

      if (conflicts.length > 0) {
        this.disposePlugin(plugin.id);
        return err(
          conflicts.map((conflict) =>
            diagnostic('E_PLUGIN_DUPLICATE', { plugin: plugin.id, ...conflict }),
          ),
        );
      }

      const undeclared = [...(contributed.get(plugin.id) ?? [])].filter(
        (point) => !manifest.contributes.includes(point),
      );
      if (undeclared.length > 0) {
        this.disposePlugin(plugin.id);
        return err([
          diagnostic('E_PLUGIN_ACTIVATE', {
            plugin: plugin.id,
            problem: `it registered into ${undeclared.map((point) => `'${point}'`).join(', ')}, which its tyto-plugin.json does not list under 'contributes'`,
          }),
        ]);
      }

      const record: InstalledPlugin = { manifest, origin };
      installed.set(plugin.id, record);
      return ok(record);
    },

    hostFor(pluginId: string): PluginHost {
      return hostWith(pluginId);
    },

    disposePlugin(pluginId: string): void {
      for (const point of points) point.removeAllFrom(pluginId);
      contributed.delete(pluginId);
      installed.delete(pluginId);
    },

    configure(config) {
      rawConfig = config;
      emitter.emit('configured', {});
    },
  };
}

/**
 * A plugin, as the loader will call it (E11.1).
 *
 * Built-ins are written to this shape today even though nothing loads them from a folder,
 * because a built-in that skipped `activate` would be a built-in exercising a different
 * code path from the one a third party gets.
 */
export interface Plugin {
  readonly id: string;
  /**
   * The plugin's own `tyto-plugin.json`, as read — **not** as a validated object.
   *
   * `unknown` on purpose. A loaded plugin's manifest is a file somebody else wrote, so the
   * host validates it; typing this field as `PluginManifest` would let a built-in hand
   * over a shape TypeScript approved and the schema never saw, which is precisely the
   * private path ADR 0007 says a built-in must not have.
   */
  readonly manifest: unknown;
  activate(host: PluginHost): Disposable | void;
}
