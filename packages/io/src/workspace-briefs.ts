import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import {
  type Diagnostic,
  type Result,
  type TemplateManifest,
  type Trust,
  diagnostic,
  err,
  isInsidePath,
  ok,
} from '@tyto/core';
import type { BriefFolder, ToBriefPorts } from '@tyto/plugin-api';

import { isMissing } from './real-paths.js';
import { writeEntry } from './source-cache.js';
import { confineToWorkspace } from './workspace-confine.js';
import { isTytoFolder } from './workspace-files.js';

/**
 * The workspace's side of `to-brief` (ADR 0172): the ports the verb plans and applies through,
 * bound to one workspace and one recipe's folder.
 *
 * The verb's checks are lexical: `into=` never climbs out, never names `.tyto`. **The real
 * path is confined again here**, after `realpath` (`confineToWorkspace`, ADR 0112), so a link
 * inside the folder that lands outside, or lands in `.tyto`, is refused on `stat` already and
 * the plan never shows it. **A folder that is not trusted writes nothing** (ADR 0111): the trust
 * is a getter asked on every call, as `workspaceFiles` asks it, so a folder restricted since the
 * plan refuses the write whatever the verb decided.
 *
 * The digest `stat` answers is SHA-256 of the file's bytes, and it is the same function Apply
 * calls again before each write, so "changed since the plan" means the bytes changed, not the
 * modification time.
 */

export interface WorkspaceBriefOptions {
  /** The workspace folder, absolute; `undefined` for a recipe in no workspace. */
  readonly workspaceFolder: string | undefined;
  /** The running recipe's folder, absolute; `undefined` for a recipe in no file yet. */
  readonly recipeFolder: string | undefined;
  /** The workspace's answer from the trust store (ADR 0111). Asked on every call. */
  readonly trust: () => Trust;
  /** The host's templates, looked up the way it looks up a brief's `template:`. */
  readonly template: (name: string) => Promise<TemplateManifest | undefined>;
  /** The host's clock as ISO 8601, which stamps an applied write. */
  readonly now?: () => string;
}

type Refusal = Result<never, readonly Diagnostic[]>;

function refuse(problem: string): Refusal {
  return err([diagnostic('E_RECIPE_BRIEF', { problem })]);
}

/** SHA-256 of a file's bytes, as hex: what `stat` answers and Apply compares. */
export function briefDigest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function workspaceBriefPorts(options: WorkspaceBriefOptions): ToBriefPorts {
  const { workspaceFolder, recipeFolder } = options;

  function folder(): BriefFolder | undefined {
    if (workspaceFolder === undefined || recipeFolder === undefined) return undefined;
    if (!isInsidePath(workspaceFolder, recipeFolder)) return undefined;
    const recipe = relative(workspaceFolder, recipeFolder).split(sep).filter(Boolean).join('/');
    return { recipe, restricted: options.trust() !== 'trusted' };
  }

  /** The real path of a workspace path, or the refusal that stops the call. */
  async function locate(path: string): Promise<Result<string, readonly Diagnostic[]>> {
    if (workspaceFolder === undefined) return refuse('writes only inside a workspace');
    if (options.trust() !== 'trusted') {
      return refuse('writes nothing in a restricted folder; trust the folder first');
    }
    // `nearest` for `stat` too: a brief not written yet does not exist, and a link on the way
    // to it still decides where Apply would write it, so the plan must refuse it already.
    const confined = await confineToWorkspace(workspaceFolder, join(workspaceFolder, path), {
      follow: 'nearest',
    });
    if ('refused' in confined) {
      return refuse(
        confined.refused === 'outside'
          ? `would write '${path}' outside the workspace`
          : `would write '${path}' out of the workspace through a link`,
      );
    }
    const [first = ''] = relative(confined.realFolder, confined.real).split(sep);
    if (isTytoFolder(first)) {
      return refuse(`would write '${path}' inside .tyto/, which only Tyto writes`);
    }
    return ok(confined.real);
  }

  return {
    template: options.template,
    folder,

    async stat(path) {
      const real = await locate(path);
      if (!real.ok) return real;
      try {
        const found = await stat(real.value);
        if (!found.isFile()) return refuse(`would write '${path}', which is a folder`);
        return ok(briefDigest(new Uint8Array(await readFile(real.value))));
      } catch (cause) {
        if (isMissing(cause)) return ok(undefined);
        return refuse(`cannot read '${path}': ${describe(cause)}`);
      }
    },

    async write(path, text) {
      const real = await locate(path);
      if (!real.ok) return real;
      try {
        const found = await stat(real.value).catch(() => undefined);
        if (found?.isDirectory() === true)
          return refuse(`would write '${path}', which is a folder`);
        // Inside the folder by the check above: the part that did not exist yet is no link.
        await mkdir(dirname(real.value), { recursive: true });
        await writeEntry(real.value, new TextEncoder().encode(text));
        return ok(undefined);
      } catch (cause) {
        return refuse(`cannot write '${path}': ${describe(cause)}`);
      }
    },

    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
