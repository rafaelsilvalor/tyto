import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { BriefSource, BriefTask } from './ports.js';

/**
 * `inbox/<id>/brief.brief` as a `BriefSource` (ADR 0008, `docs/integrations.md`).
 *
 * The folder shape is the Jacurutu contract, which is why it is worth implementing even
 * though Jacurutu is not running yet: the same layout is the integration-test harness and
 * the thing a person drops a folder into by hand. One shape, three users.
 *
 * `assets/` beside the brief is the asset base, because that is where Jacurutu puts an
 * issue's attachments. A task without one still renders — a brief that references no
 * image needs no folder — and paths then resolve against the task folder itself.
 */

/** The two names the contract fixes. Changing either breaks Jacurutu, not just a test. */
export const BRIEF_FILE = 'brief.brief';
export const ASSETS_DIR = 'assets';

export interface FsInboxOptions {
  /** The folder holding one subfolder per task. */
  readonly root: string;
  /**
   * Where `ack` moves a finished task. Defaults to a `done` folder beside the inbox.
   *
   * Moving rather than deleting: a render that produced the wrong thing is a render
   * somebody will want to look at again, and a queue that destroys its input to signal
   * success has thrown away the only copy of what went in.
   */
  readonly done?: string;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function fsInbox(options: FsInboxOptions): BriefSource {
  const root = resolve(options.root);
  const done = options.done === undefined ? resolve(root, '..', 'done') : resolve(options.done);

  return {
    async pull(): Promise<readonly BriefTask[]> {
      let entries: string[];
      try {
        entries = (await readdir(root, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        // An inbox that does not exist yet is an inbox with nothing in it. A watcher
        // started before the folder was created should wait, not crash.
        return [];
      }

      // Sorted, so two runs over the same folder hand tasks over in the same order and a
      // test does not depend on what the filesystem felt like returning.
      entries.sort((left, right) => left.localeCompare(right));

      const tasks: BriefTask[] = [];
      for (const id of entries) {
        const directory = join(root, id);
        const briefPath = join(directory, BRIEF_FILE);
        // A folder without a brief is not a task. It is half-copied, or it is something
        // else entirely; either way picking it up would render nothing and ack it.
        if (!(await isFile(briefPath))) continue;

        const assets = join(directory, ASSETS_DIR);
        tasks.push({
          id,
          brief: await readFile(briefPath, 'utf8'),
          assetBase: (await isDirectory(assets)) ? assets : directory,
          briefPath,
        });
      }

      return tasks;
    },

    async ack(id: string): Promise<void> {
      await mkdir(done, { recursive: true });
      // `rename` rather than copy-then-delete: on one filesystem it is atomic, so a task
      // is never visible in both folders and never in neither. Across devices it fails
      // loudly, which is the right answer — a caller that moved its inbox onto a network
      // share should hear about it rather than silently get a copy.
      await rename(join(root, id), join(done, id));
    },
  };
}
