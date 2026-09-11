import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Artifact } from '@tyto/pipeline';

import type { OutputSink, TaskOutput } from './ports.js';
import { type RenderResult, renderResultSchema } from './result.js';

/**
 * `outbox/<id>/out/…` as an `OutputSink` (ADR 0011, `docs/integrations.md`).
 *
 * The half of the file contract Tyto writes. Every file lands atomically, which is the
 * promise the pipeline delegated here: E6.1's job deliberately opens nothing itself, so
 * "cancelling leaves no partial files" is only true if whoever does open files never
 * leaves a half-written one behind.
 */

/** The name the contract fixes for the folder and for the manifest inside it. */
export const OUT_DIR = 'out';
export const RESULT_FILE = 'result.json';

export interface FsOutboxOptions {
  /** The folder that gets one subfolder per task. */
  readonly root: string;
  /**
   * Validate `result.json` against the schema before writing it.
   *
   * On by default, and cheap. The document is the only thing the other side of ADR 0011
   * reads, so a shape that drifted would be discovered by Jacurutu rather than by us.
   */
  readonly validate?: boolean;
}

/**
 * Writes to `<path>.part` and renames.
 *
 * A rename within one filesystem is atomic: a reader either sees the old file or the
 * whole new one, never the first half of a PNG. A watcher on the other side — Jacurutu,
 * or the desktop queue panel — would otherwise be able to pick up a truncated image and
 * have no way to tell.
 */
async function writeAtomic(path: string, bytes: Uint8Array | string): Promise<void> {
  const temporary = `${path}.part`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  } catch (cause) {
    // A failed write must not leave the scratch file behind pretending to be output.
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
}

export function fsOutbox(options: FsOutboxOptions): OutputSink {
  const root = resolve(options.root);
  const validate = options.validate ?? true;

  return {
    async open(id: string): Promise<TaskOutput> {
      const directory = join(root, id, OUT_DIR);
      await mkdir(directory, { recursive: true });

      return {
        async write(artifact: Artifact): Promise<void> {
          await writeAtomic(join(directory, artifact.name), artifact.bytes);
        },

        async finish(result: RenderResult): Promise<void> {
          if (validate) {
            const parsed = renderResultSchema.safeParse(result);
            if (!parsed.success) {
              throw new Error(
                `result.json for '${id}' does not match its schema: ${parsed.error.issues
                  .map(
                    (issue) => `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`,
                  )
                  .join('; ')}`,
              );
            }
          }

          // Last, and atomically. `result.json` appearing is how a reader knows the task
          // is finished, so it must not appear before the artifacts it lists.
          await writeAtomic(join(directory, RESULT_FILE), `${JSON.stringify(result, null, 2)}\n`);
        },
      };
    },
  };
}
