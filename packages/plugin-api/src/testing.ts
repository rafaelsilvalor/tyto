import { type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import {
  type DataResolver,
  type RecipeRun,
  type RecipeState,
  type RunClock,
  type Table,
  parseRecipe,
  runRecipe,
} from '@tyto/recipe';

import type { FetchedResponse, HostCapabilities, HostFetchInit } from './capabilities.js';
import { type ResolvedSettings, resolveSettings } from './configuration.js';
import { PLUGIN_API_VERSION } from './engine.js';
import { type InProcessHost, createPluginHost } from './host.js';
import { runGuest } from './isolation/guest.js';
import { inProcessChannel } from './isolation/in-process-channel.js';
import { connectIsolatedPlugin } from './isolation/isolated-plugin.js';
import type { SandboxReport } from './isolation/protocol.js';
import { checkInstallable } from './loader.js';
import type { PluginManifest } from './manifest.js';
import { type RecipeRegistries, recipeRegistriesOf } from './recipes.js';

/**
 * `@tyto/plugin-api/testing` — a plugin run the way the app runs it, inside a test (TYTO-445,
 * ADR 0150).
 *
 * A plugin's repository has the contract's types and nothing that exercises them: a copied
 * manifest schema says a manifest parses, not that this host would load it. So this is the
 * app's path with the process taken out — the manifest through `checkInstallable` against the
 * installed `PLUGIN_API_VERSION`, the code behind the real `runGuest` and
 * `connectIsolatedPlugin` over a channel that clones every message as `postMessage` does, and
 * the registrations replayed through `tryActivate`, the door every refusal is decided at.
 *
 * **What it does not exercise is the sandbox.** The guest runs in the test's own process, so
 * nothing is confined and `requireSandbox` is `false`; the child process and its permission
 * flags stay the CLI's and the desktop's to test (ADR 0049). And it reads no folder: the
 * caller hands over the manifest's text and an import of the built entry, which is two lines
 * in a Node test and keeps this entry as pure as the rest of the package (ADR 0010).
 */

/** What the guest reports: it is not confined, and says why, should a host ever ask. */
const IN_PROCESS: SandboxReport = {
  runtime: 'the test harness',
  canary: 'readable',
  detail: 'the plugin runs inside the test process',
};

export interface TestPluginOptions {
  /** The plugin's `tyto-plugin.json`, as text: it is parsed and checked as install does. */
  readonly manifest: string;
  /** Imports the plugin's built entry, `() => import('../dist/index.js')`. */
  readonly load: () => Promise<unknown>;
  /**
   * Values by the key a settings file writes, `jira.site`. Resolved as the desktop resolves
   * `settings.json`: a value the declaration refuses costs that key alone, and its default
   * applies (ADR 0073).
   */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** The plugin's own section of `.tyto/project.json`, handed on every recipe verb call. */
  readonly section?: unknown;
  /** Credentials by key. `host.credentials.set` and `delete` change this harness's copy. */
  readonly secrets?: Readonly<Record<string, string>>;
  /**
   * Answers `host.fetch`, after the manifest's permissions allowed the URL. Absent, a fetch
   * rejects naming the URL, so a test that forgot to stub one is told which.
   */
  readonly fetch?: (url: string, init: HostFetchInit) => Promise<FetchedResponse>;
  /** Any other port — `workspaceRead`, a cache of the test's own — over the harness's. */
  readonly capabilities?: Partial<HostCapabilities>;
  /** One call's deadline, for a test that proves a slow verb is ended. */
  readonly deadlineMs?: number;
}

export interface TestRecipeOptions {
  /** What now is for `age`, `stamp` and `month-into`: fix it, or the run reads the machine's. */
  readonly clock?: RunClock;
  readonly params?: Readonly<Record<string, string>>;
  readonly input?: Table;
  readonly state?: RecipeState;
  readonly resolveData?: DataResolver;
  /** The recipes a `run` line may name, as their source text, by name. */
  readonly include?: Readonly<Record<string, string>>;
}

function withoutInclude(options: TestRecipeOptions): Omit<TestRecipeOptions, 'include'> {
  const { include: _include, ...rest } = options;
  return rest;
}

export interface PluginHarness {
  /** The manifest as install validated it. */
  readonly manifest: PluginManifest;
  /** The host it was activated into: `registry` lists every contribution, by point. */
  readonly host: InProcessHost;
  /** The settings as resolved after activation, with what was refused. */
  readonly settings: ResolvedSettings;
  /** The recipe verbs and derivations, with the generic ones, each handed the section. */
  readonly recipes: RecipeRegistries;
  /** Parses and runs a recipe over {@link recipes}; `recipe test` is added when absent. */
  runRecipe(source: string, options?: TestRecipeOptions): Promise<Result<RecipeRun, Diagnostics>>;
  /** Every `host.log` line, as `level: line`. */
  readonly log: readonly string[];
  /** The credential the plugin holds now, after any `set` or `delete` of its own. */
  secret(key: string): string | undefined;
  /** The reason, if the plugin's side of the channel ended without being asked to. */
  crashed(): string | undefined;
  close(): Promise<void>;
}

function capabilitiesOf(
  plugin: string,
  options: TestPluginOptions,
  secrets: Map<string, string>,
): HostCapabilities {
  const fetch =
    options.fetch ??
    ((url: string) =>
      Promise.reject(
        new Error(`the test harness has no fetch for ${url}; pass one in testPlugin's options`),
      ));
  return {
    hostName: 'the test harness',
    fetch,
    credential: (_plugin, key) => Promise.resolve(secrets.get(key)),
    describeCredential: (_plugin, key) => `the test harness's secrets for ${plugin} (${key})`,
    storeCredential: (_plugin, key, value) => {
      secrets.set(key, value);
      return Promise.resolve();
    },
    deleteCredential: (_plugin, key) => Promise.resolve(secrets.delete(key)),
    ...options.capabilities,
  };
}

/**
 * Loads, activates and configures one plugin, or answers the diagnostics the app would have
 * refused it with: `E_PLUGIN_ENGINE` and the manifest's own codes from install, and
 * `E_PLUGIN_ACTIVATE` and its siblings from `tryActivate`.
 */
export async function testPlugin(
  options: TestPluginOptions,
): Promise<Result<PluginHarness, Diagnostics>> {
  const installable = checkInstallable(options.manifest, 'tyto-plugin.json', PLUGIN_API_VERSION);
  if (!installable.ok) return installable;
  const manifest = installable.value;

  const log: string[] = [];
  const secrets = new Map(Object.entries(options.secrets ?? {}));
  const channel = inProcessChannel((guest) => runGuest(guest, options.load, IN_PROCESS));
  const connected = await connectIsolatedPlugin({
    name: manifest.name,
    manifest: manifest as unknown,
    channel,
    requireSandbox: false,
    capabilities: capabilitiesOf(manifest.name, options, secrets),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    log: {
      debug: (line) => log.push(`debug: ${line}`),
      info: (line) => log.push(`info: ${line}`),
      warn: (line) => log.push(`warn: ${line}`),
      error: (line) => log.push(`error: ${line}`),
    },
  });
  if (!connected.ok) return connected;
  const isolated = connected.value;

  const host = createPluginHost();
  const activated = host.tryActivate(isolated.plugin, 'external');
  if (!activated.ok) {
    await isolated.close();
    return err(activated.error);
  }

  // After activation, as the apps do: the declarations are what the values are checked by.
  const entries = Object.entries(options.settings ?? {}).map(([key, value]) => ({ key, value }));
  const settings = resolveSettings(host.registry.configurations(), entries);
  host.configure(settings.config);

  const recipes = recipeRegistriesOf(host.registry, {
    sectionOf: (plugin) => (plugin === manifest.name ? options.section : undefined),
  });

  return ok({
    manifest,
    host,
    settings,
    recipes,
    log,
    async runRecipe(source, recipeOptions = {}) {
      const text = /^\s*recipe\s/u.test(source) ? source : `recipe test\n${source}`;
      const parsed = parseRecipe(text);
      if (!parsed.ok) return err(parsed.error);
      return runRecipe(parsed.value, {
        ...recipes,
        resolveRecipe: (name) => {
          const included = recipeOptions.include?.[name];
          if (included === undefined) {
            return Promise.resolve(
              err([
                diagnostic('E_RECIPE_RUN', {
                  recipe: name,
                  problem: 'is not one of the recipes this test included',
                }),
              ]),
            );
          }
          return Promise.resolve(parseRecipe(included));
        },
        ...withoutInclude(recipeOptions),
      });
    },
    secret: (key) => secrets.get(key),
    crashed: () => isolated.crashed(),
    close: () => isolated.close(),
  });
}
