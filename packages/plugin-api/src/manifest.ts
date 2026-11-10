import { type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import { z } from 'zod';

import { PROCESS_PERMISSION, programNameProblem, programScriptProblem } from './process.js';

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
 * The seventeen extension points, spelled the way a manifest spells them.
 *
 * The same seventeen as `contributions.ts`, `sources.ts` and `recipes.ts`, which is a duplication with a
 * reason: those are TypeScript types a plugin's *code* implements, and these are strings a
 * JSON file declares before any code exists.
 *
 * They are held equal from both sides. `Point`'s name is typed `ContributionPoint`, so the
 * host cannot open a point this list does not name; and `host.test.ts` activates one
 * plugin declaring all seventeen and registering into all seventeen, which fails if the host
 * knows a point this list has forgotten.
 */
export const CONTRIBUTION_POINTS = [
  'source',
  'sink',
  'exporter',
  'rasterizer',
  'template-pack',
  'brand-kit',
  'directive',
  'editor.command',
  'editor.keymap',
  'editor.vim',
  'panel',
  'configuration',
  'theme',
  'asset-source',
  'font-source',
  'recipe-verb',
  'recipe-derivation',
] as const;

export type ContributionPoint = (typeof CONTRIBUTION_POINTS)[number];

/** The points whose contributions are named in the plugin's recipe namespace (ADR 0135). */
const NAMESPACED_POINTS: readonly ContributionPoint[] = ['recipe-verb', 'recipe-derivation'];

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

/**
 * The runtime's own URL parser, read off `globalThis` as `capabilities.ts` reads it: this
 * package compiles against no platform's types (ADR 0010).
 */
const { URL } = globalThis as unknown as {
  URL: new (input: string) => {
    readonly protocol: string;
    readonly hostname: string;
    readonly username: string;
    readonly password: string;
    readonly hash: string;
  };
};

/**
 * The two hosts a sign-in endpoint may reach over plain `http` (ADR 0174): a test provider on
 * this machine. Anything else carries a person's authorization code or refresh token, which
 * travels over `https` or not at all.
 */
const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Why a sign-in endpoint is refused, or `undefined` when it is one. */
function signinUrlProblem(value: string): string | undefined {
  let parsed: InstanceType<typeof URL>;
  try {
    parsed = new URL(value);
  } catch {
    return 'must be an absolute URL';
  }
  if (parsed.username !== '' || parsed.password !== '') return 'must not carry a user or password';
  // RFC 6749 section 3.1: an endpoint URI must not include a fragment.
  if (parsed.hash !== '') return 'must not carry a fragment';
  if (parsed.protocol === 'https:') return undefined;
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.includes(parsed.hostname)) return undefined;
  return 'must be an https URL, or http on 127.0.0.1 or localhost';
}

const signinUrl = z.string().superRefine((value, context) => {
  const problem = signinUrlProblem(value);
  if (problem !== undefined) context.addIssue({ code: 'custom', message: problem });
});

/** A sign-in's id: the `<id>` of `signin:<id>` and of `host.signin.accessToken(id)`. */
const SIGNIN_ID = /^[a-z][a-z0-9-]*$/;

/** The prefix of the permission that grants a sign-in, `signin:<id>`. */
const SIGNIN_PERMISSION = 'signin:';

/**
 * One OAuth 2.0 provider a plugin signs in to through the host (ADR 0174): authorization code
 * with PKCE, run by the host in the system browser. Tyto keeps no provider list; the plugin
 * names its own endpoints here, where a person reads them before installing.
 */
const signinSchema = z.strictObject({
  /** The authorization endpoint the browser opens. */
  authorize: signinUrl,
  /** The token endpoint the host exchanges the code at, and refreshes at. */
  token: signinUrl,
  clientId: z.string().min(1, 'must not be empty'),
  scopes: z
    .array(z.string().min(1, 'must not be empty'))
    .refine((values) => new Set(values).size === values.length, 'must not repeat a scope'),
  /**
   * **Not a secret.** An installed app cannot keep one: Google issues its desktop clients a
   * "client secret" its own documentation calls non-confidential, and its token endpoint asks
   * for it anyway. Optional, sent only when declared, and readable by anybody who reads the
   * manifest, so a provider that treats it as confidential cannot be declared this way.
   */
  clientSecret: z.string().min(1, 'must not be empty').optional(),
});

export type SigninDeclaration = z.infer<typeof signinSchema>;

export const pluginManifestSchema = z
  .strictObject({
    name: z
      .string()
      .regex(
        NAME,
        'must be lowercase letters, digits and hyphens, starting with a letter or digit',
      ),
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
     * because the vocabulary is still growing — `net:<host>` gates `host.fetch` and
     * `credentials:<key>` gates `host.credentials` (ADR 0042), `font:<family>` sends a code template
     * a face installed on this machine (ADR 0048), `signin:<id>` gates `host.signin` and must
     * match a `signin` entry (ADR 0174), `process:<name>` gates `host.process` and must name one
     * program by its bare name (ADR 0182) — and closing an enum now would
     * reject the next scope before it is written. E11 closes it; until then a typo in a
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
    /**
     * The plugin's share of the recipe vocabulary (ADR 0135): every verb and derivation it
     * contributes is `<namespace>.<name>`, and no other loaded plugin may declare the same one.
     * Declared here, once, so a person reading the manifest knows which names it brings.
     */
    namespace: z
      .string()
      .regex(
        /^[a-z][a-z0-9-]*$/,
        'must be lowercase letters, digits and hyphens, starting with a letter',
      )
      .optional(),
    /**
     * Every kind of write the plugin's actions and sinks may plan (ADR 0129 decision 3), so a
     * person reads before installing what it could change: `transition`, `assign`. Each verb
     * declares the subset it uses, and the host refuses a planned write outside it.
     */
    writes: z
      .array(
        z
          .string()
          .regex(
            /^[a-z][a-z0-9-]*$/,
            'must be lowercase letters, digits and hyphens, starting with a letter',
          ),
      )
      .refine((values) => new Set(values).size === values.length, 'must not repeat a write')
      .optional(),
    /**
     * The providers this plugin signs in to through the host, by id (ADR 0174). Each entry
     * needs the permission `signin:<id>`, and each `signin:<id>` permission needs its entry.
     */
    signin: z
      .record(
        z.string().regex(SIGNIN_ID, 'must be lowercase letters, digits and hyphens'),
        signinSchema,
      )
      .optional(),
    /**
     * The plugin's own programs (ADR 0184): a declared `process:<name>` mapped to a script in
     * the plugin's folder, which the host runs on its bundled Node instead of looking `<name>`
     * up on `PATH`. Each key needs its `process:<name>` permission; each value is a relative
     * path ending in `.mjs`, `.cjs` or `.js`.
     */
    programs: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((manifest, context) => {
    for (const [name, script] of Object.entries(manifest.programs ?? {})) {
      const nameProblem = programNameProblem(name);
      if (nameProblem !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['programs', name],
          message: `names a program that ${nameProblem}`,
        });
      } else if (!manifest.permissions.includes(`${PROCESS_PERMISSION}${name}`)) {
        context.addIssue({
          code: 'custom',
          path: ['programs', name],
          message: `needs the permission ${PROCESS_PERMISSION}${name}`,
        });
      }
      const scriptProblem = programScriptProblem(script);
      if (scriptProblem !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['programs', name],
          message: `names a script that ${scriptProblem}`,
        });
      }
    }
    const namespaced = manifest.contributes.filter((point) => NAMESPACED_POINTS.includes(point));
    if (namespaced.length > 0 && manifest.namespace === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['namespace'],
        message: `is required by a plugin that contributes ${namespaced.join(' or ')}`,
      });
    }
    if (manifest.writes !== undefined && !manifest.contributes.includes('recipe-verb')) {
      context.addIssue({
        code: 'custom',
        path: ['writes'],
        message: 'is declared by a plugin that contributes no recipe-verb, so nothing could write',
      });
    }
    const declared = Object.keys(manifest.signin ?? {});
    for (const id of declared) {
      if (!manifest.permissions.includes(`${SIGNIN_PERMISSION}${id}`)) {
        context.addIssue({
          code: 'custom',
          path: ['signin', id],
          message: `needs the permission ${SIGNIN_PERMISSION}${id}`,
        });
      }
    }
    manifest.permissions.forEach((permission, index) => {
      if (
        permission.startsWith(SIGNIN_PERMISSION) &&
        !declared.includes(permission.slice(SIGNIN_PERMISSION.length))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['permissions', index],
          message: `grants a sign-in the manifest does not declare under signin`,
        });
      }
      // One program by name, never a path or a pattern (ADR 0182): the person reads which one.
      if (permission.startsWith(PROCESS_PERMISSION)) {
        const problem = programNameProblem(permission.slice(PROCESS_PERMISSION.length));
        if (problem !== undefined) {
          context.addIssue({
            code: 'custom',
            path: ['permissions', index],
            message: `names a program that ${problem}`,
          });
        }
      }
      // A sign-in's tokens are the host's (ADR 0174): no permission reaches them as a credential.
      if (permission.startsWith(`credentials:${SIGNIN_PERMISSION}`)) {
        context.addIssue({
          code: 'custom',
          path: ['permissions', index],
          message: "names a sign-in's tokens, which only the host holds; use host.signin",
        });
      }
    });
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
