import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  DELIVERY_RECORD_FILE,
  DELIVERY_RECORD_FOLDER,
  type Diagnostic,
  type Result,
  type Trust,
  type TrustStore,
  diagnostic,
  err,
  ok,
} from '@tyto/core';
import type {
  DeliveryLayout,
  DeliveryListing,
  DeliveryPlace,
  ToDeliveryPorts,
} from '@tyto/plugin-api';

import { fsTrustStore } from './fs-trust-store.js';
import { isMissing } from './real-paths.js';
import { writeEntry } from './source-cache.js';
import { briefDigest } from './workspace-briefs.js';
import { confineToWorkspace } from './workspace-confine.js';
import { isTytoFolder } from './workspace-files.js';
import { loadWorkspace } from './workspace.js';

/**
 * The workspace's side of `to-delivery` (ADR 0210): the ports the verb plans and applies
 * through, bound to one workspace.
 *
 * **The layout is read again on every run and every Apply** (`loadWorkspace`), so a
 * `delivery.parent` changed in the project file since the last run is where the next plan lands.
 * Every path is confined after `realpath` (`confineToWorkspace`, ADR 0112) and never lands in
 * `.tyto`, and **a folder that is not trusted writes nothing** (ADR 0111): the trust is a getter
 * asked on every call, as `workspaceBriefPorts` asks it.
 *
 * The digest is the same SHA-256 of the bytes `to-brief` compares, so "changed since the plan"
 * means the record's bytes changed.
 *
 * `list` is what `deliveries` reads the records back through (ADR 0211): the folders directly
 * under `delivery.parent`, hidden ones and `.tyto` left out, each record read through its own
 * confinement, in a trusted folder only, as every other call.
 */

export interface WorkspaceDeliveryOptions {
  /** The workspace folder, absolute; `undefined` for a recipe in no workspace. */
  readonly workspaceFolder: string | undefined;
  /** The workspace's answer from the trust store (ADR 0111). Asked on every call. */
  readonly trust: () => Trust;
  /** `TYTO_HOME`, where the trust store and the work profiles live. */
  readonly home: string;
  /** The trust store the project file's sheets are read with; the one in `home` when absent. */
  readonly trustStore?: TrustStore;
  /** The host's clock as ISO 8601, which stamps an applied write. */
  readonly now?: () => string;
}

type Refusal = Result<never, readonly Diagnostic[]>;

function refuse(problem: string): Refusal {
  return err([diagnostic('E_RECIPE_DELIVERY', { problem })]);
}

export function workspaceDeliveryPorts(options: WorkspaceDeliveryOptions): ToDeliveryPorts {
  const { workspaceFolder, home } = options;
  const trustStore = options.trustStore ?? fsTrustStore({ home });

  function folder(): DeliveryPlace | undefined {
    if (workspaceFolder === undefined) return undefined;
    return { restricted: options.trust() !== 'trusted' };
  }

  async function layout(): Promise<Result<DeliveryLayout, readonly Diagnostic[]>> {
    if (workspaceFolder === undefined) return refuse('writes only inside a workspace');
    const loaded = await loadWorkspace(workspaceFolder, { trustStore, home });
    if (loaded === undefined) return refuse('writes no delivery in the Tyto home folder');
    const { parent, folders } = loaded.project.delivery;
    // `core` kept `parent` inside the workspace already (ADR 0157 §3); asked again, cheaply.
    const between = relative(loaded.folder, parent);
    if (between === '..' || between.startsWith(`..${sep}`) || isAbsolute(between)) {
      return refuse(`finds delivery.parent '${parent}' outside the workspace`);
    }
    return ok({ parent: between.split(sep).filter(Boolean).join('/'), folders });
  }

  /** The real path of a workspace path, or the refusal that stops the call. */
  async function locate(path: string): Promise<Result<string, readonly Diagnostic[]>> {
    if (workspaceFolder === undefined) return refuse('writes only inside a workspace');
    if (options.trust() !== 'trusted') {
      return refuse('writes nothing in a restricted folder; trust the folder first');
    }
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

  async function bytesOf(
    path: string,
  ): Promise<Result<Uint8Array | undefined, readonly Diagnostic[]>> {
    const real = await locate(path);
    if (!real.ok) return real;
    try {
      const found = await stat(real.value);
      if (!found.isFile()) return refuse(`would write '${path}', which is a folder`);
      return ok(new Uint8Array(await readFile(real.value)));
    } catch (cause) {
      if (isMissing(cause)) return ok(undefined);
      return refuse(`cannot read '${path}': ${describe(cause)}`);
    }
  }

  /**
   * One folder's record for `list`: its text, nothing when it has none, or why it may not be
   * read. Each folder is confined on its own, so a link out of the workspace is one folder's
   * problem and the others still read.
   */
  async function recordOf(
    path: string,
  ): Promise<{ readonly record?: string; readonly problem?: string }> {
    const confined = await confineToWorkspace(
      workspaceFolder ?? '',
      join(workspaceFolder ?? '', path, DELIVERY_RECORD_FOLDER, DELIVERY_RECORD_FILE),
      { follow: 'nearest' },
    );
    if ('refused' in confined) {
      return {
        problem:
          confined.refused === 'outside'
            ? 'it is outside the workspace'
            : 'it leads out of the workspace through a link',
      };
    }
    try {
      return { record: await readFile(confined.real, 'utf8') };
    } catch (cause) {
      if (isMissing(cause)) return {};
      return { problem: `its record cannot be read: ${describe(cause)}` };
    }
  }

  return {
    folder,
    layout,

    async list(parent) {
      const real = await locate(parent);
      if (!real.ok) return real;
      let entries: Dirent[];
      try {
        entries = await readdir(real.value, { withFileTypes: true });
      } catch (cause) {
        if (isMissing(cause)) return ok([]);
        return refuse(`cannot list '${parent}': ${describe(cause)}`);
      }
      const names = entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
        .filter((name) => !name.startsWith('.') && !isTytoFolder(name))
        .sort();
      const listed: DeliveryListing[] = [];
      for (const name of names) {
        const path = parent === '' ? name : `${parent}/${name}`;
        listed.push({ name, path, ...(await recordOf(path)) });
      }
      return ok(listed);
    },

    async read(path) {
      const bytes = await bytesOf(path);
      if (!bytes.ok) return bytes;
      return ok(bytes.value === undefined ? undefined : new TextDecoder().decode(bytes.value));
    },

    async stat(path) {
      const bytes = await bytesOf(path);
      if (!bytes.ok) return bytes;
      return ok(bytes.value === undefined ? undefined : briefDigest(bytes.value));
    },

    async make(path) {
      const real = await locate(path);
      if (!real.ok) return real;
      try {
        const found = await stat(real.value).catch(() => undefined);
        if (found !== undefined && !found.isDirectory()) {
          return refuse(`would make the folder '${path}', and a file is there`);
        }
        await mkdir(real.value, { recursive: true });
        return ok(undefined);
      } catch (cause) {
        return refuse(`cannot make '${path}': ${describe(cause)}`);
      }
    },

    async write(path, text) {
      const real = await locate(path);
      if (!real.ok) return real;
      try {
        const found = await stat(real.value).catch(() => undefined);
        if (found?.isDirectory() === true) {
          return refuse(`would write '${path}', which is a folder`);
        }
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
