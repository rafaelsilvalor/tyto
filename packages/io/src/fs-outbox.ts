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

export interface FsTaskOutputOptions {
  /** See {@link FsOutboxOptions.validate}. On by default. */
  readonly validate?: boolean;
  /** Named in the schema-mismatch message, so a reader knows which task produced it. */
  readonly label?: string;
}

/**
 * One folder as a `TaskOutput`: artifacts beside a `result.json`, nothing around them.
 *
 * Split out of `fsOutbox` because `tyto render --out <dir>` writes into exactly the folder
 * it was given (`docs/integrations.md`: `--out <task>/out`), while the outbox derives
 * `<root>/<id>/out` from a task id. Same files, same atomic write, two ways of arriving at
 * the directory — and the atomic write is the part neither of them may have its own copy
 * of.
 */
export async function fsTaskOutput(
  directory: string,
  options: FsTaskOutputOptions = {},
): Promise<TaskOutput> {
  const full = resolve(directory);
  const validate = options.validate ?? true;
  const label = options.label ?? full;
  await mkdir(full, { recursive: true });

  return {
    async write(artifact: Artifact): Promise<void> {
      await writeAtomic(join(full, artifact.name), artifact.bytes);
    },

    async finish(result: RenderResult): Promise<void> {
      if (validate) {
        const parsed = renderResultSchema.safeParse(result);
        if (!parsed.success) {
          throw new Error(
            `result.json for '${label}' does not match its schema: ${parsed.error.issues
              .map((issue) => `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`)
              .join('; ')}`,
          );
        }
      }

      // Last, and atomically. `result.json` appearing is how a reader knows the task is
      // finished, so it must not appear before the artifacts it lists.
      await writeAtomic(join(full, RESULT_FILE), `${JSON.stringify(result, null, 2)}\n`);
    },
  };
}

export function fsOutbox(options: FsOutboxOptions): OutputSink {
  const root = resolve(options.root);

  return {
    async open(id: string): Promise<TaskOutput> {
      return fsTaskOutput(join(root, id, OUT_DIR), {
        ...(options.validate === undefined ? {} : { validate: options.validate }),
        label: id,
      });
    },
  };
}
