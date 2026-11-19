import type { Dirent } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

import {
  DELIVERY_RECORD_FILE,
  DELIVERY_RECORD_FOLDER,
  type DeliveryImage,
  type Diagnostic,
  type Result,
  type Size,
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
import { imageSize } from './image-size.js';
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
 *
 * Given the layout's `exports`, `list` also reads, for each folder with a record, the PNG and
 * JPEG files at the root of that exports folder, each one's pixel size from its header only
 * (`imageSize`, no decode and no new dependency), and counts the other files beside the record:
 * what `deliveries` checks the record against (ADR 0215).
 *
 * `rename` renames a delivery's export for `rename-exports` (ADR 0218), both paths confined as a
 * write's are, never over another file.
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
  /**
   * The pixel size of each format in the host's format catalogue (`formats.yaml`), which a
   * name `delivery.sizes` leaves out falls back to (ADR 0215). None when absent.
   */
  readonly formatSizes?: () => Promise<Readonly<Record<string, Size>>>;
}

/** The images a delivery's check reads: what a designer exports, as a remote count reads them. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

/**
 * How much of an image is read for its size. A PNG states it in its first 24 bytes; a JPEG after
 * its metadata, which a camera or Photoshop can make long, so the head is generous and a file
 * whose size is not in it is read whole once.
 */
const IMAGE_HEAD_BYTES = 256 * 1024;

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
    const { parent, folders, exports, sizes } = loaded.project.delivery;
    // `core` kept `parent` inside the workspace already (ADR 0157 §3); asked again, cheaply.
    const between = relative(loaded.folder, parent);
    if (between === '..' || between.startsWith(`..${sep}`) || isAbsolute(between)) {
      return refuse(`finds delivery.parent '${parent}' outside the workspace`);
    }
    const catalogue = (await options.formatSizes?.()) ?? {};
    return ok({
      parent: between.split(sep).filter(Boolean).join('/'),
      folders,
      exports,
      sizes: { ...catalogue, ...sizes },
    });
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

  /**
   * The images at the root of a delivery's exports folder and the editables beside its record,
   * for the check (ADR 0215). A folder that is not there holds nothing; one that leads out of
   * the workspace is not read, and holds nothing either: its record already read, or did not.
   */
  async function landedIn(
    path: string,
    exports: string,
  ): Promise<{ readonly images: readonly DeliveryImage[]; readonly editables: number }> {
    const images: DeliveryImage[] = [];
    const exportsFolder = exports === '.' ? path : `${path}/${exports}`;
    for (const name of await filesIn(exportsFolder)) {
      const dot = name.lastIndexOf('.');
      if (dot <= 0 || !IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase())) continue;
      const size = await sizeOf(`${exportsFolder}/${name}`);
      images.push(size === undefined ? { name } : { name, size });
    }
    const beside = await filesIn(`${path}/${DELIVERY_RECORD_FOLDER}`);
    const editables = beside.filter((name) => name !== DELIVERY_RECORD_FILE).length;
    return { images, editables };
  }

  /** The visible files directly in a workspace folder, by name; none when it cannot be read. */
  async function filesIn(path: string): Promise<readonly string[]> {
    const confined = await confineToWorkspace(
      workspaceFolder ?? '',
      join(workspaceFolder ?? '', path),
      { follow: 'nearest' },
    );
    if ('refused' in confined) return [];
    try {
      const entries = await readdir(confined.real, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }

  /** An image's pixel size from its header, or `undefined` when it does not read. */
  async function sizeOf(path: string): Promise<Size | undefined> {
    const confined = await confineToWorkspace(
      workspaceFolder ?? '',
      join(workspaceFolder ?? '', path),
      { follow: 'nearest' },
    );
    if ('refused' in confined) return undefined;
    try {
      const handle = await open(confined.real, 'r');
      try {
        const head = Buffer.alloc(IMAGE_HEAD_BYTES);
        const { bytesRead } = await handle.read(head, 0, IMAGE_HEAD_BYTES, 0);
        const size = imageSize(head.subarray(0, bytesRead));
        if (size !== undefined || bytesRead < IMAGE_HEAD_BYTES) return size;
      } finally {
        await handle.close();
      }
      return imageSize(await readFile(confined.real));
    } catch {
      return undefined;
    }
  }

  return {
    folder,
    layout,

    async list(parent, exports) {
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
        const record = await recordOf(path);
        const landed =
          exports === undefined || record.record === undefined ? {} : await landedIn(path, exports);
        listed.push({ name, path, ...record, ...landed });
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

    // What `stat` answers for the same bytes, so a copy file's base compares with the file on
    // disk (ADR 0217).
    digest(text) {
      return briefDigest(new TextEncoder().encode(text));
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

    // ADR 0218: both ends confined as a write is, and never over another file. A new name that
    // differs only in case finds the same file on the file systems that fold case, which is
    // told apart from another file by its identity, never by the name.
    async rename(from, to) {
      const source = await locate(from);
      if (!source.ok) return source;
      const target = await locate(to);
      if (!target.ok) return target;
      try {
        const found = await lstat(source.value, { bigint: true }).catch(() => undefined);
        if (found === undefined) return refuse(`cannot rename '${from}': it is not there`);
        if (!found.isFile()) return refuse(`would rename '${from}', which is not a file`);
        const there = await lstat(target.value, { bigint: true }).catch(() => undefined);
        if (there !== undefined && (there.ino !== found.ino || there.dev !== found.dev)) {
          return refuse(`would rename '${from}' over '${to}', which is there`);
        }
        // The confined path takes the case of a file already there (`realpath`); the name
        // asked for is the one the file must take.
        const named = join(dirname(target.value), to.slice(to.lastIndexOf('/') + 1));
        await rename(source.value, named);
        return ok(undefined);
      } catch (cause) {
        return refuse(`cannot rename '${from}': ${describe(cause)}`);
      }
    },

    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
