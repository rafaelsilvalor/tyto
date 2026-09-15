import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { type Layout, layoutFrom } from '../../shared/layout.js';

/**
 * Where the panels were last time, in a JSON file beside the credential store and the
 * recent list (E9.10).
 *
 * A file and not a database (ADR 0009), in `app.getPath('userData')`, for the third time in
 * this app and for the third time on the same argument: a person can read it, delete it,
 * and see exactly what is being remembered about them.
 *
 * **Reading never fails.** `layoutFrom` reconciles whatever was on disk against the layout
 * this build ships — a panel the file has never heard of is added, a panel this build no
 * longer has is dropped, and a file that is not JSON at all is the default. A window that
 * would not open because of a remembered pane width is the one outcome worse than
 * forgetting the width.
 */

export interface LayoutStore {
  read(): Promise<Layout>;
  write(layout: Layout): Promise<void>;
}

export function fileLayoutStore(file: string): LayoutStore {
  return {
    read: async () => {
      try {
        return layoutFrom(JSON.parse(await readFile(file, 'utf8')));
      } catch {
        // No file on a first run, and unparseable JSON on a hand-edited one. Both mean the
        // same thing here and `layoutFrom(undefined)` is the default layout.
        return layoutFrom(undefined);
      }
    },

    write: async (layout) => {
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(layout, null, 2), 'utf8');
      } catch {
        // A disk that will not take the layout costs a person the memory of where they put
        // a splitter. It must not cost them the drag they just did, or the session.
      }
    },
  };
}
