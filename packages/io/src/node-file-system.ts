import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { DirectoryEntry, FileSystem } from '@tyto/core';

import { isInside } from './contain.js';

/**
 * `core`'s `FileSystem` port, on a real disk.
 *
 * The first adapter for it: `TemplateRegistry` and `loadFormats` have been asking this
 * port questions since E4.1 and every caller so far has been a test with a `Map` of
 * strings. This is what lets `tyto render` read a real templates folder (E6.3).
 *
 * `join` is part of the port on purpose — a pure package that concatenated with `/` would
 * be guessing about a platform it is not allowed to know it is running on. Here it is
 * `node:path`, so a Windows caller gets backslashes and the same code reads the same
 * folder on both.
 */

export interface NodeFileSystemOptions {
  /**
   * Every path is resolved against this, and a path that escapes it is refused.
   *
   * Not a security boundary — a symlink inside the root still leads out, and this is not
   * a sandbox. It is a mistake boundary: a template folder or a brief that reaches for
   * `../../../etc` is a bug or a hostile input, and a renderer that reads whatever it was
   * pointed at would happily embed the file in an image. Leave it unset and the whole
   * filesystem is readable, which is what a CLI given an absolute path needs.
   */
  readonly root?: string;
}

export function nodeFileSystem(options: NodeFileSystemOptions = {}): FileSystem {
  const root = options.root === undefined ? undefined : resolve(options.root);

  function within(path: string): string {
    const full = resolve(path);
    if (root !== undefined && !isInside(root, full)) {
      // Thrown, not returned: the port's two reads reject rather than returning a
      // `Result`, and a caller in `core` catches and turns it into a diagnostic at its
      // own edge. A path outside the root is the same kind of answer as a missing file.
      throw new Error(`Path '${path}' is outside the permitted root '${root}'.`);
    }
    return full;
  }

  return {
    join: (...segments) => join(...segments),

    async readDirectory(path: string): Promise<readonly DirectoryEntry[]> {
      const entries = await readdir(within(path), { withFileTypes: true });
      return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
    },

    async readFile(path: string): Promise<string> {
      // UTF-8 and nothing else. Briefs, manifests and templates are text the author
      // typed; a file in another encoding is a file whose accents are already wrong, and
      // guessing at encodings is how a template silently renders mojibake.
      return readFile(within(path), 'utf8');
    },
  };
}
