import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';

import type { ConfigurationImage, ConfigurationImageResolver } from '@tyto/core';

import { isInside } from './contain.js';
import { hashOf } from './hash.js';
import { EMBEDDABLE_MIME } from './mime.js';

/**
 * The images plugin files name, read for `resolveTemplateConfigurations` (ADR 0151, TYTO-439).
 *
 * A path is relative to the folder of the file that wrote it. **After `realpath` it must stay
 * inside the workspace folder for a project file and inside `TYTO_HOME` for a machine file**
 * (ADR 0151 decision 2): a project's plugin files are content its source ships, and an image
 * path is no way to read the rest of the machine. Nothing is decoded; the bytes are hashed, so
 * a configuration's image is an `AssetRef` like a brief's, and the export reads it by `path`.
 */

export interface PluginFileImagesOptions {
  /** `TYTO_HOME`, the root a machine file's image must stay in. */
  readonly home: string;
  /** The workspace folder, the root a project file's image must stay in. */
  readonly workspace?: string;
  /** Per-file ceiling, 32 MB by default, as the brief's assets have. */
  readonly maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

export function pluginFileImages(options: PluginFileImagesOptions): ConfigurationImageResolver {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  return async (path, { directory, scope }): Promise<ConfigurationImage> => {
    const root = scope === 'project' ? options.workspace : options.home;
    if (root === undefined) return { problem: 'has no folder it may be read from' };
    if (EMBEDDABLE_MIME[extname(path).toLowerCase()] === undefined) {
      return { problem: `names '${path}', which is not an image an export can embed` };
    }

    let real: string;
    let realRoot: string;
    try {
      real = await realpath(resolve(directory, path));
      realRoot = await realpath(root);
    } catch {
      return { problem: `names '${path}', which is not there` };
    }
    if (!isInside(realRoot, real)) {
      const folder = scope === 'project' ? 'the workspace folder' : 'TYTO_HOME';
      return { problem: `names '${path}', which is outside ${folder}` };
    }

    const info = await stat(real).catch(() => undefined);
    if (info === undefined || !info.isFile()) {
      return { problem: `names '${path}', which is not a file` };
    }
    if (info.size > maxBytes) return { problem: `names '${path}', which is too large` };
    const bytes = await readFile(real);

    // Named from its root rather than as written: two files' `./logo.png` are two images, and
    // a scene keeps one asset per id.
    const from = relative(realRoot, real).replace(/\\/gu, '/');
    const id = scope === 'project' ? from : `TYTO_HOME/${from}`;
    return { ref: { id, source: 'file', path: real, hash: hashOf(bytes) } };
  };
}
