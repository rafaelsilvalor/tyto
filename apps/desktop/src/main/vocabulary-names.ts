import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import { DATA_FILE_MAX_BYTES, isInside } from '@tyto/io';
import { VOCABULARY_EXTENSION } from '@tyto/recipe';

import type { IpcResponse } from '../../shared/ipc.js';
import { VOCABULARY_NAMES_MAX } from '../../shared/ipc.js';
import { vocabularyPointers } from './recipe-authoring.js';

/**
 * What a recipe's `@./<file>.vocab.json#/<pointer>` may name, for its completion (TYTO-402,
 * ADR 0176): the vocabulary files beside the recipe, or the pointers of one of them.
 *
 * **Confined to the recipe's own folder** (ADR 0112): a `file` written with `..`, an absolute
 * one, or one whose link leads out of the folder is never read, and answers nothing. Only a
 * `*.vocab.json` is read, as large as a data file may be. The folder is the one main holds for
 * the tab; the window names only the file the person typed after `@./`.
 */

export type VocabularyNames = IpcResponse<'recipe:vocabulary-names'>;

const NONE: VocabularyNames = { files: [], pointers: [] };

export async function vocabularyNames(
  recipePath: string | undefined,
  file: string | undefined,
): Promise<VocabularyNames> {
  if (recipePath === undefined) return NONE;
  const folder = dirname(recipePath);
  try {
    const folderReal = await realpath(folder);
    if (file === undefined) {
      const files = (await readdir(folderReal, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(VOCABULARY_EXTENSION))
        .map((entry) => entry.name)
        .sort()
        .slice(0, VOCABULARY_NAMES_MAX);
      return { files, pointers: [] };
    }
    if (isAbsolute(file) || !file.endsWith(VOCABULARY_EXTENSION)) return NONE;
    // Lexical first, then after `realpath`: a link inside the folder may lead out of it.
    const target = resolve(folder, file);
    if (!isInside(folder, target)) return NONE;
    const real = await realpath(target);
    if (!isInside(folderReal, real)) return NONE;
    const found = await stat(real);
    if (!found.isFile() || found.size > DATA_FILE_MAX_BYTES) return NONE;
    const text = await readFile(real, 'utf8');
    return { files: [], pointers: vocabularyPointers(text).slice(0, VOCABULARY_NAMES_MAX) };
  } catch {
    // A file not there, or a folder gone: nothing to offer, which completion says by offering none.
    return NONE;
  }
}
