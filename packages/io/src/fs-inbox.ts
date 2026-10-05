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
 * Asset paths resolve the way they do everywhere else (ADR 0056): as written, from the task
 * folder, then from `assets/` beside the brief — which is where Jacurutu puts an issue's
 * attachments, so `./logo.png` with the file only in `assets/` keeps working. A task
 * without `assets/` still renders; a brief that references no image needs no folder.
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

/**
 * Waits between attempts at the `ack` rename: six attempts, 310 ms of waiting at most.
 *
 * Windows refuses to rename a folder while any file inside it is open, with `EPERM` (or
 * `EACCES`/`EBUSY`, depending on who holds it). Measured for TYTO-198: an `ack` racing a
 * `pull` of the same inbox — which reads every `brief.brief` — failed 25 times in 300, and 0
 * in 300 alone. The queue panel races itself that way (its sweep and its listing read the
 * brief while it acknowledges), and an antivirus or indexer opening a fresh file does the
 * same. Those locks last milliseconds, so a short wait gets past them. A lock that outlives
 * the window — a folder open in Explorer — still fails, and the caller reports it.
 */
export const ACK_RETRY_DELAYS_MS: readonly number[] = [10, 20, 40, 80, 160];

/** The codes a held file gives a rename on Windows. `ENOENT` is not one: it is gone. */
const TRANSIENT_LOCK = new Set(['EPERM', 'EACCES', 'EBUSY']);

const wait = (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

/**
 * `rename`, tried again while the failure is a lock somebody else is holding. Anything else —
 * above all `ENOENT`, a second consumer that moved the task first — fails at once.
 */
export async function renameRetryingLocks(
  from: string,
  to: string,
  move: (from: string, to: string) => Promise<void> = rename,
  delays: readonly number[] = ACK_RETRY_DELAYS_MS,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await move(from, to);
      return;
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException | undefined)?.code;
      const delay = delays[attempt];
      if (delay === undefined || code === undefined || !TRANSIENT_LOCK.has(code)) throw cause;
      await wait(delay);
    }
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

        tasks.push({
          id,
          brief: await readFile(briefPath, 'utf8'),
          briefDirectory: directory,
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
      // share should hear about it rather than silently get a copy. Tried again for a
      // moment while Windows says the folder is held (TYTO-198), never longer.
      await renameRetryingLocks(join(root, id), join(done, id));
    },
  };
}
