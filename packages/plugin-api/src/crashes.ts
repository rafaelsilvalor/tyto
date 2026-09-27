import { type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import { z } from 'zod';

/**
 * `crashes.json` — when each installed plugin's process last ended unasked (ADR 0041).
 *
 * **Beside `plugins.json`, not inside it.** The CLIs already shipped read `plugins.json`
 * with a strict schema, and the CLI and the desktop are versioned separately: a key added
 * there would make the older app on the same machine refuse the file and load no installed
 * plugin at all. So the history lives in a file no older version reads.
 *
 * **History, not a refusal.** Nothing that activates plugins reads this. A plugin that
 * crashed once is activated again on the next run, because a crash can be the input's and
 * not the code's; `plugin list` shows it with its time, and `install`, `enable` and
 * `remove` clear it.
 */

/** When a plugin's process ended unasked, and what the platform said about it. */
export interface PluginCrash {
  /** ISO 8601, as the host's clock read it. */
  readonly at: string;
  readonly reason: string;
}

export interface PluginCrashes {
  readonly crashes: Readonly<Record<string, PluginCrash>>;
}

export const EMPTY_PLUGIN_CRASHES: PluginCrashes = { crashes: {} };

// Tolerant from its first version, for the reason `plugins.json` became tolerant: a key a
// newer app adds must not cost an older one its reading of the file.
const pluginCrashesSchema = z.object({
  crashes: z.record(
    z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be a plugin name'),
    z.object({ at: z.string().min(1), reason: z.string() }),
  ),
});

export function parsePluginCrashes(
  source: string,
  path: string,
): Result<PluginCrashes, Diagnostics> {
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

  const parsed = pluginCrashesSchema.safeParse(document);
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

/** Sorted by name and indented, like `plugins.json`. */
export function serializePluginCrashes(crashes: PluginCrashes): string {
  const sorted = Object.fromEntries(
    Object.entries(crashes.crashes).sort(([left], [right]) => left.localeCompare(right)),
  );
  return `${JSON.stringify({ crashes: sorted }, null, 2)}\n`;
}

export function withPluginCrash(
  crashes: PluginCrashes,
  name: string,
  crash: PluginCrash | undefined,
): PluginCrashes {
  const next = { ...crashes.crashes };
  if (crash === undefined) {
    delete next[name];
  } else {
    next[name] = crash;
  }
  return { crashes: next };
}
