import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

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

/**
 * The subfolder of a delivery holding what a person would open to change something.
 *
 * **Portuguese, deliberately, and the only user-facing name in this package that is.** It is
 * read by whoever receives the folder rather than by a program — `docs/git-workflow.md` keeps
 * the repository English, and this is a word on somebody's desktop, not an identifier. Spelled
 * without the accent because a folder name travels through zip tools, shells and browsers that
 * still disagree about one.
 */
export const EDITABLE_DIR = 'editaveis';

/** Without the dot, and matching `BRIEF_FILE`'s. */
const BRIEF_EXTENSION = 'brief';

export interface FsDeliveryOutputOptions {
  /**
   * The folder's name, and the copied brief's. `basename(briefPath, '.brief')` at the caller.
   *
   * One path segment: a `/` in it would silently deliver somewhere else.
   */
  readonly name: string;
  /** The brief that produced the artwork, copied into {@link EDITABLE_DIR} unchanged. */
  readonly brief: Uint8Array;
  /** See {@link FsOutboxOptions.validate}. On by default. */
  readonly validate?: boolean;
  /** Named in the schema-mismatch message, so a reader knows which task produced it. */
  readonly label?: string;
}

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
  await mkdir(full, { recursive: true });
  return taskOutput({ artifacts: full, result: full, ...options, label: options.label ?? full });
}

/**
 * The two directories a `TaskOutput` writes into, which are the same one until they are not.
 *
 * `fsTaskOutput` puts artifacts and `result.json` in one folder; `fsDeliveryOutput` puts the
 * artwork at the top and the report underneath. Everything else about writing — the atomic
 * rename, the schema check, `result.json` going last — is identical, and this is the one copy
 * of it. Two adapters with their own copies would be two ways for a half-written PNG to
 * reach a watcher.
 */
interface TaskOutputDirectories {
  readonly artifacts: string;
  readonly result: string;
  readonly validate?: boolean;
  readonly label: string;
}

function taskOutput(directories: TaskOutputDirectories): TaskOutput {
  const validate = directories.validate ?? true;

  return {
    async write(artifact: Artifact): Promise<void> {
      await writeAtomic(join(directories.artifacts, artifact.name), artifact.bytes);
    },

    async finish(result: RenderResult): Promise<void> {
      if (validate) {
        const parsed = renderResultSchema.safeParse(result);
        if (!parsed.success) {
          throw new Error(
            `result.json for '${directories.label}' does not match its schema: ${parsed.error.issues
              .map((issue) => `${issue.path.map(String).join('.') || '(root)'} ${issue.message}`)
              .join('; ')}`,
          );
        }
      }

      // Last, and atomically. `result.json` appearing is how a reader knows the task is
      // finished, so it must not appear before the artifacts it lists.
      await writeAtomic(
        join(directories.result, RESULT_FILE),
        `${JSON.stringify(result, null, 2)}\n`,
      );
    },
  };
}

/**
 * The folder a person sends out: `<destination>/<name>/`, artwork at the top, the rest under
 * {@link EDITABLE_DIR}.
 *
 * ```
 * <destination>/<name>/
 *   <artwork>-<format>.png        nothing but artwork at this level
 *   editaveis/
 *     <name>.brief                the brief that produced the files above
 *     result.json
 * ```
 *
 * **The top level holds artwork and nothing else, and that is the whole point of the
 * layout.** A folder with a report in it is a folder somebody has to tidy before dropping it
 * into a delivery, and the one file they would have to delete is the one file Tyto's own
 * contract says never to move (ADR 0011). So it goes down a level instead, where it is still
 * exactly where a reader of `editaveis/` expects to find it.
 *
 * **This is not `--out`.** `tyto render --out <dir>` writes into exactly the directory named
 * and that is published behaviour Jacurutu reads (`docs/render-contract.md`); this is a
 * second layout that a caller opts into, under which the directory named becomes the parent.
 *
 * ## The name is the brief's, unsanitised, on purpose
 *
 * `name` comes from a file that already exists on disk, so it is already legal for this
 * filesystem. Running it through the `fileSafe` of `artifactName` would be a second
 * sanitiser with its own opinion, and two sanitisers is how one folder ends up named two
 * things.
 *
 * ## An existing folder is written into, not cleared
 *
 * Exporting the same brief twice reuses the folder and overwrites by name — the same rule
 * `--out` has today, chosen for that reason rather than invented here. **What it costs is
 * worth naming: a file from a previous run that this one does not produce survives.** A
 * brief edited from three slides down to two leaves `slide-3-feed.png` in the delivery, and
 * nothing in `result.json` mentions it, because `result.json` lists what this run wrote.
 * Cleaning the folder, or refusing a non-empty one, is a decision with a blast radius —
 * deleting somebody's files — and it is not this card's to take.
 */
export async function fsDeliveryOutput(
  destination: string,
  options: FsDeliveryOutputOptions,
): Promise<TaskOutput> {
  // Refused, not rewritten. A guard is not the second sanitiser the doc comment argues
  // against: it changes no name, it declines one that would put the delivery somewhere the
  // caller did not name. `basename` at the caller already guarantees this; an embedder
  // calling the port directly does not.
  if (options.name === '' || options.name !== basename(options.name)) {
    throw new TypeError(
      `A delivery folder's name is one path segment, got '${options.name}'. It is the brief's ` +
        "own file name without the extension — basename(briefPath, '.brief').",
    );
  }

  const folder = join(resolve(destination), options.name);
  const editable = join(folder, EDITABLE_DIR);
  // One `mkdir -p` makes both: `editaveis/` is inside the folder it is created under.
  await mkdir(editable, { recursive: true });

  // Before any artifact, so a run that dies half way still shows what it was rendering.
  // `result.json` is the finished signal and is still the last thing written.
  await writeAtomic(join(editable, `${options.name}.${BRIEF_EXTENSION}`), options.brief);

  return taskOutput({
    artifacts: folder,
    result: editable,
    ...(options.validate === undefined ? {} : { validate: options.validate }),
    label: options.label ?? folder,
  });
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
