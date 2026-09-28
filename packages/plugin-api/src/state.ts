import { type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import { z } from 'zod';

/**
 * `plugins.json` — what `tyto plugin install` decided, beside the folders it copied
 * (`docs/plugin-api.md`, Lifecycle).
 *
 * A folder under `plugins/` says a plugin's files are on this machine. It does not say that
 * anybody agreed to run it, or to which permissions, and a folder somebody dropped there by
 * hand has had neither question asked. So the approval is recorded apart from the files, by
 * the one command that asks it, and the loader reads both: **a folder with no entry here is
 * not installed**, and an entry whose plugin now asks for more than it was granted is not
 * activated until it is installed again.
 *
 * The permissions recorded here are what the person approved. `net:` and `credentials:` are
 * enforced where the plugin asks the host (ADR 0042); the runtime confines the rest of what
 * the plugin's process can do to its own folder, and not its network (ADR 0049).
 *
 * **A key this version does not know is dropped, not refused** (ADR 0041). The CLI and the
 * desktop are versioned separately and share this file, so the older of the two must still
 * read what the newer wrote; a strict schema here would make one new field cost the older
 * app every installed plugin. What it drops, it does not write back either.
 */

export interface PluginStateEntry {
  /** A disabled plugin stays installed and is not activated. */
  readonly enabled: boolean;
  /** Exactly what the person approved at install, in the manifest's order. */
  readonly permissions: readonly string[];
  /** What `install` was given — a folder, a git URL or an npm spec — for the listing. */
  readonly source: string;
}

export interface PluginState {
  readonly plugins: Readonly<Record<string, PluginStateEntry>>;
}

export const EMPTY_PLUGIN_STATE: PluginState = { plugins: {} };

const pluginStateSchema = z.object({
  plugins: z.record(
    z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be a plugin name'),
    z.object({
      enabled: z.boolean(),
      permissions: z.array(z.string().min(1)),
      source: z.string().min(1),
    }),
  ),
});

/**
 * The bytes of `plugins.json`, as a state.
 *
 * Every problem is `E_PLUGIN_STATE`, and a caller that meets one loads **no** installed
 * plugin: a file that cannot say which plugins were approved cannot approve any of them.
 */
export function parsePluginState(source: string, path: string): Result<PluginState, Diagnostics> {
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch (cause) {
    return err([
      diagnostic('E_PLUGIN_STATE', {
        path,
        problem: cause instanceof Error ? cause.message : String(cause),
      }),
    ]);
  }

  const parsed = pluginStateSchema.safeParse(document);
  if (parsed.success) return ok(parsed.data);
  return err(
    parsed.error.issues.map((issue) =>
      diagnostic('E_PLUGIN_STATE', {
        path,
        problem: `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`,
      }),
    ),
  );
}

/** Sorted by name and indented, so two installs in either order write the same file. */
export function serializePluginState(state: PluginState): string {
  const plugins = Object.fromEntries(
    Object.entries(state.plugins).sort(([left], [right]) => left.localeCompare(right)),
  );
  return `${JSON.stringify({ plugins }, null, 2)}\n`;
}

export function withPluginEntry(
  state: PluginState,
  name: string,
  entry: PluginStateEntry | undefined,
): PluginState {
  const plugins = { ...state.plugins };
  if (entry === undefined) {
    delete plugins[name];
  } else {
    plugins[name] = entry;
  }
  return { plugins };
}
