import { type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import { z } from 'zod';

/**
 * `tyto-plugin.json`, as a schema (`docs/plugin-api.md`, Plugin package).
 *
 * The manifest is the only part of a plugin that is read before any of its code runs, so
 * it is the only part that can be wrong in a way somebody can be told about rather than
 * crashed by. Everything here is therefore validated into diagnostics with a **field
 * path** — `contributes.1`, `config.$schema` — because "the manifest is invalid" is not a
 * sentence anybody can act on.
 *
 * **Built-ins go through this too.** `packages/export-html/tyto-plugin.json` is a real
 * file validated by the real schema, not a shape declared in TypeScript beside the code
 * that uses it. A built-in with a private path into the host would be a private path
 * nobody could discover was missing from the public API (ADR 0007), and the manifest is
 * where that temptation is strongest, because the host could just as easily have asked for
 * an object.
 */

/**
 * The nine extension points, spelled the way a manifest spells them.
 *
 * The same nine as `contributions.ts`, which is a duplication with a reason: those are
 * TypeScript types a plugin's *code* implements, and these are strings a JSON file
 * declares before any code exists.
 *
 * They are held equal from both sides. `Point`'s name is typed `ContributionPoint`, so the
 * host cannot open a point this list does not name; and `host.test.ts` activates one
 * plugin declaring all nine and registering into all nine, which fails if the host knows a
 * point this list has forgotten.
 */
export const CONTRIBUTION_POINTS = [
  'source',
  'sink',
  'exporter',
  'rasterizer',
  'template-pack',
  'directive',
  'editor.command',
  'editor.keymap',
  'panel',
] as const;

export type ContributionPoint = (typeof CONTRIBUTION_POINTS)[number];

/**
 * A plugin name, which is also its id.
 *
 * One identity, not two. VS Code splits `publisher` from `name` and joins them back into
 * an id; nothing here needs that yet, and two names for one plugin is two things to keep
 * in step. `Plugin.id` and `manifest.name` are asserted equal at activation.
 *
 * Lowercase, because the id reaches a filesystem the day a loader copies a plugin into
 * `~/.tyto/plugins/<name>/`, and a case-sensitive id on a case-insensitive disk is a bug
 * that only appears on somebody else's machine.
 */
const NAME = /^[a-z0-9][a-z0-9-]*$/;

/**
 * An engine range, checked for shape and not for meaning.
 *
 * `>=0.1`, `^1.2.3`, `>=0.1 || ^1`. What it deliberately does not do is decide whether the
 * running host satisfies it: that is a semver comparison, it needs a semver
 * implementation, and it is the loader's job (E11.1) because only the loader knows which
 * host is running. Rejecting `lates` here and leaving `>=99` to the loader is the honest
 * division — this file can see a typo and cannot see the future.
 */
const ENGINE_RANGE =
  /^(>=|<=|>|<|\^|~|=)?\d+(\.\d+){0,2}(\s*\|\|\s*(>=|<=|>|<|\^|~|=)?\d+(\.\d+){0,2})*$/;

/** `major.minor.patch`, with an optional prerelease tag. Narrower than the engine range. */
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?$/;

export const pluginManifestSchema = z.strictObject({
  name: z
    .string()
    .regex(NAME, 'must be lowercase letters, digits and hyphens, starting with a letter or digit'),
  version: z.string().regex(VERSION, 'must be a semver version, such as 0.1.0'),
  engine: z
    .string()
    .regex(ENGINE_RANGE, 'must be a version range, such as >=0.1, ^1.2.3 or >=0.1 || ^1'),
  /**
   * At least one. A plugin that contributes nothing is not a plugin that does nothing
   * harmful — it is a plugin whose author meant something and did not say it, and the host
   * has no way to guess which point they meant.
   */
  contributes: z
    .array(z.enum(CONTRIBUTION_POINTS))
    .nonempty('must name at least one extension point')
    .refine((points) => new Set(points).size === points.length, 'must not repeat a point'),
  /**
   * Declared at install time and enforced at call time (`docs/plugin-api.md`, Isolation).
   *
   * Validated as shape only: non-empty strings, no duplicates. The *vocabulary* stays open
   * because the spec names exactly one scope so far — `net:*`, filtering `host.fetch` —
   * and closing an enum around one known member would reject the second permission the
   * loader epic invents before it is written. E11 closes it; until then a typo in a
   * permission is caught by the grant prompt, which a person reads.
   */
  permissions: z
    .array(z.string().min(1, 'must not be empty'))
    .refine((values) => new Set(values).size === values.length, 'must not repeat a permission'),
  /**
   * Where the plugin's own configuration schema lives, for the editor that offers
   * completion over it. The host never dereferences it: `PluginHost.config()` validates
   * against a `ZodType` the plugin hands over in code, which is the copy that has to be
   * right.
   */
  config: z.strictObject({ $schema: z.string().min(1, 'must not be empty') }).optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/** `contributes.1`, `config.$schema`, or `(root)` when the whole document is wrong. */
function fieldPath(path: readonly PropertyKey[]): string {
  return path.map(String).join('.') || '(root)';
}

/**
 * A decoded document against the schema.
 *
 * Separate from {@link parsePluginManifest} because a built-in's manifest arrives already
 * decoded — the bundler inlines the JSON import — while a loaded plugin's arrives as the
 * bytes somebody's disk handed over. Both reach the same schema; only the JSON decode
 * differs, and pretending a built-in re-parses text it never had would be a fiction in the
 * one place this package is trying not to have one.
 */
export function validatePluginManifest(document: unknown): Result<PluginManifest, Diagnostics> {
  const parsed = pluginManifestSchema.safeParse(document);
  if (parsed.success) return ok(parsed.data);

  return err(
    parsed.error.issues.flatMap((issue) => {
      // A `strictObject` reports every unknown key of one object in a single issue whose
      // path stops at the object. Split, so each stray key is named — the same reason
      // `core`'s YAML bridge splits them (`config/yaml-source.ts`).
      if (issue.code === 'unrecognized_keys') {
        return issue.keys.map((key) =>
          diagnostic('E_PLUGIN_MANIFEST_SHAPE', {
            path: fieldPath([...issue.path, key]),
            problem: 'unknown key',
          }),
        );
      }
      return [
        diagnostic('E_PLUGIN_MANIFEST_SHAPE', {
          path: fieldPath(issue.path),
          problem: issue.message,
        }),
      ];
    }),
  );
}

/**
 * The bytes of a `tyto-plugin.json` against the schema — what a loader calls (E11.1).
 *
 * `path` is only ever used to say which file failed to parse; nothing is read from a disk
 * here, because this package is pure (ADR 0010).
 */
export function parsePluginManifest(
  source: string,
  path = 'tyto-plugin.json',
): Result<PluginManifest, Diagnostics> {
  let document: unknown;
  try {
    document = JSON.parse(source);
  } catch (cause) {
    return err([
      diagnostic('E_PLUGIN_MANIFEST_SYNTAX', {
        path,
        problem: cause instanceof Error ? cause.message : String(cause),
      }),
    ]);
  }

  return validatePluginManifest(document);
}
