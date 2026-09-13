import { isErr } from '@tyto/core';
import type { ZodType } from 'zod';

import type {
  DirectiveContribution,
  EditorCommand,
  EditorKeymap,
  Exporter,
  ExporterRegistry,
  PanelContribution,
  Provided,
  TemplatePack,
} from './contributions.js';
import { type ContributionPoint, type PluginManifest, validatePluginManifest } from './manifest.js';

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
  registerDirective(directive: DirectiveContribution): Disposable;
  registerCommand(command: EditorCommand): Disposable;
  registerKeymap(keymap: EditorKeymap): Disposable;
  registerPanel(panel: PanelContribution): Disposable;

  /**
   * The plugin's own configuration, validated.
   *
   * A schema rather than a shape, because a plugin's config arrives as JSON somebody typed
   * and "it parsed" is not the same as "it is what this plugin needs". Throws on a
   * mismatch: a plugin activating against configuration it cannot use should stop there
   * rather than half-work.
   */
  config<T>(schema: ZodType<T>): T;

  readonly log: Logger;
  readonly events: TypedEmitter;
}

/**
 * Where a plugin came from, which is the one thing `tyto plugin list` shows that the
 * manifest cannot say about itself: a manifest is written by its author, and an author has
 * no way to know whether their plugin ended up bundled or installed.
 *
 * `external` has no producer yet — the loader is E11.1 — and exists because the alternative
 * is a listing that says nothing and has to grow a column later.
 */
export type PluginOrigin = 'built-in' | 'external';

/** A plugin the host has activated: its validated manifest, and where it came from. */
export interface InstalledPlugin {
  readonly manifest: PluginManifest;
  readonly origin: PluginOrigin;
}

/** What the composition root reads back out. The plugins never see this half. */
export interface PluginRegistry {
  /** Every activated plugin, in activation order — what `tyto plugin list` prints. */
  plugins(): readonly InstalledPlugin[];
  readonly exporters: ExporterRegistry;
  sources<T>(): readonly Provided<T>[];
  sinks<T>(): readonly Provided<T>[];
  rasterizers<T>(): readonly Provided<T>[];
  templatePacks(): readonly TemplatePack[];
  directives(): readonly DirectiveContribution[];
  commands(): readonly EditorCommand[];
  keymaps(): readonly EditorKeymap[];
  panels(): readonly PanelContribution[];
}

export interface PluginHostOptions {
  /** Defaults to a logger that drops everything, so a test is not a wall of output. */
  readonly log?: Logger;
  /** Raw configuration, by plugin id. `config()` validates a slice of it. */
  readonly config?: Readonly<Record<string, unknown>>;
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
  /** What one plugin gets. Its `config()` reads that plugin's slice, and nobody else's. */
  hostFor(pluginId: string): PluginHost;
  readonly registry: PluginRegistry;
  /** Withdraws every contribution a plugin made, in one call. */
  disposePlugin(pluginId: string): void;
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

/** One extension point's contributions, keyed by id so a duplicate is a lookup away. */
class Point<T extends { readonly id: string }> {
  private readonly entries = new Map<string, Entry<T>>();

  constructor(
    private readonly name: ContributionPoint,
    private readonly emitter: TypedEmitter,
    /** Which points each plugin has contributed to, so `activate` can check the manifest. */
    private readonly contributed: Map<string, Set<ContributionPoint>>,
  ) {}

  add(plugin: string, value: T): Disposable {
    const existing = this.entries.get(value.id);
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

  removeAllFrom(plugin: string): void {
    for (const [id, entry] of [...this.entries]) {
      if (entry.plugin !== plugin) continue;
      this.entries.delete(id);
      this.emitter.emit('disposed', { point: this.name, id });
    }
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
  const directives = new Point<DirectiveContribution>('directive', emitter, contributed);
  const commands = new Point<EditorCommand>('editor.command', emitter, contributed);
  const keymaps = new Point<EditorKeymap>('editor.keymap', emitter, contributed);
  const panels = new Point<PanelContribution>('panel', emitter, contributed);

  const points = [
    exporters,
    sources,
    sinks,
    rasterizers,
    templatePacks,
    directives,
    commands,
    keymaps,
    panels,
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
    directives: () => directives.list(),
    commands: () => commands.list(),
    keymaps: () => keymaps.list(),
    panels: () => panels.list(),
  };

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

      const result = plugin.activate(this.hostFor(plugin.id));

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

    hostFor(pluginId: string): PluginHost {
      return {
        registerExporter: (exporter) => exporters.add(pluginId, exporter),
        registerSource: (contribution) => sources.add(pluginId, contribution),
        registerSink: (contribution) => sinks.add(pluginId, contribution),
        registerRasterizer: (contribution) => rasterizers.add(pluginId, contribution),
        registerTemplatePack: (pack) => templatePacks.add(pluginId, pack),
        registerDirective: (directive) => directives.add(pluginId, directive),
        registerCommand: (command) => commands.add(pluginId, command),
        registerKeymap: (keymap) => keymaps.add(pluginId, keymap),
        registerPanel: (panel) => panels.add(pluginId, panel),

        config<T>(schema: ZodType<T>): T {
          const parsed = schema.safeParse(options.config?.[pluginId]);
          if (!parsed.success) {
            throw new TypeError(
              `Configuration for plugin '${pluginId}' does not match the schema it asked ` +
                `for: ${parsed.error.issues
                  .map(
                    (issue) => `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`,
                  )
                  .join('; ')}`,
            );
          }
          return parsed.data;
        },

        log,
        events: emitter,
      };
    },

    disposePlugin(pluginId: string): void {
      for (const point of points) point.removeAllFrom(pluginId);
      contributed.delete(pluginId);
      installed.delete(pluginId);
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
