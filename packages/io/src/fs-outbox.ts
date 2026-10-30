import { lstat, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { type Diagnostic, type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import type { Artifact } from '@tyto/pipeline';

import { type LeftoverRun, readPreviousDelivery, removeLeftovers } from './leftovers.js';
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

/** Where a delivery says which template made it. Beside the brief, because it is about it. */
export const TEMPLATE_FILE = 'template.txt';

/**
 * Enough to identify a template, and deliberately not enough to rebuild one.
 *
 * Structural rather than `TemplateManifest`: this writes three lines for a person, and a
 * manifest also carries `formats` and `slots`, which are the template's business and not the
 * delivery's.
 */
export interface DeliveryTemplate {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
}

/**
 * A `TaskOutput` over a folder a person reuses, which can tidy what an earlier export left.
 *
 * Separate from `finish` because the warnings it returns belong in the `result.json` that
 * `finish` writes, so the caller needs them first.
 */
export interface ReusableTaskOutput extends TaskOutput {
  /**
   * Removes the files the previous export's `result.json` listed and this run did not write
   * (ADR 0054), and returns one warning per file removed or kept. Call it **before** `finish`
   * — and before `result.json` is replaced, which `finish` is what does. A no-op returning
   * nothing unless the output was opened with `removeLeftovers`.
   */
  removeLeftovers(run: LeftoverRun): Promise<Diagnostics>;
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
async function writeAtomic(
  path: string,
  bytes: Uint8Array | string,
): Promise<Diagnostic | undefined> {
  return placeAtomic(path, (temporary) => writeFile(temporary, bytes));
}

/**
 * Fills `<path>.part`, renames it over `path`, and answers `E_OUTPUT_FILE_BLOCKED` when a
 * folder holds `path`; every other failure is thrown (TYTO-243).
 *
 * The mirror of {@link makeFolder}, and decided the same way: **by looking, not by the error
 * code.** Windows answers a rename onto a folder with `EPERM`, which is also what it says for
 * a file another program holds open, and only the second can go away by itself. So the name
 * is asked what it is once the write has failed. Anything but a file there fails the same way
 * on every attempt until somebody moves it, which is exit 1; a file (held, or read-only) or
 * nothing at all keeps the throw, and with it exit 2. `lstat`, because a link is not a file
 * this could have written into either.
 *
 * Not `renameRetryingLocks`: the lock that one waits out is the queue reading its own inbox,
 * and nothing in Tyto reads a delivery while it is being written. So a folder in the way is
 * answered at once, without the retry window.
 *
 * `move` is the seam a test uses to stand in for a failure it cannot cause from Node.
 */
export async function placeAtomic(
  path: string,
  fill: (temporary: string) => Promise<void>,
  move: (from: string, to: string) => Promise<void> = rename,
): Promise<Diagnostic | undefined> {
  const temporary = `${path}.part`;
  try {
    await fill(temporary);
    await move(temporary, path);
    return undefined;
  } catch (cause) {
    // A failed write must not leave the scratch file behind pretending to be output.
    await rm(temporary, { force: true }).catch(() => undefined);
    const found = await lstat(path).catch(() => undefined);
    if (found === undefined || found.isFile()) throw cause;
    return diagnostic('E_OUTPUT_FILE_BLOCKED', { path });
  }
}

export interface FsTaskOutputOptions {
  /** See {@link FsOutboxOptions.validate}. On by default. */
  readonly validate?: boolean;
  /** Named in the schema-mismatch message, so a reader knows which task produced it. */
  readonly label?: string;
  /**
   * Make {@link ReusableTaskOutput.removeLeftovers} remove what the previous export wrote
   * here and this one did not (ADR 0054). **Off by default, and off for `--out`**: that
   * folder belongs to the ADR 0011 caller, who reconciles against `result.json` itself. On
   * for a folder a person picked and will send as it is, and for the `outbox/<id>/out/`
   * that the desktop queue and `tyto watch` reuse (ADR 0059, ADR 0060).
   */
  readonly removeLeftovers?: boolean;
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
): Promise<ReusableTaskOutput> {
  const full = resolve(directory);
  await mkdir(full, { recursive: true });
  return taskOutput({
    artifacts: full,
    result: full,
    ...(options.validate === undefined ? {} : { validate: options.validate }),
    label: options.label ?? full,
    removeLeftovers: options.removeLeftovers ?? false,
  });
}

export interface FsArtworkOutputOptions {
  /** Named in errors, so a reader knows which export produced them. */
  readonly label?: string;
}

/**
 * One folder as a `TaskOutput` that holds the artwork and nothing else (ADR 0157, TYTO-490).
 *
 * The export box, an export preset and `tyto render --folder` write here: a folder a person
 * picked to receive the files, so no `result.json`, no copied brief and no `assets/` appear
 * beside them. Without a report there is no record of which files an earlier export wrote,
 * so `removeLeftovers` removes nothing — a file this export does not produce stays, and is
 * the person's to delete. Overwriting by name is the only thing done to what was there.
 *
 * The folder is made with `makeFolder`, so a file holding a name the path needs is an
 * `E_DELIVERY_FOLDER_BLOCKED` in the answer, not a throw (TYTO-129).
 */
export async function fsArtworkOutput(
  directory: string,
  options: FsArtworkOutputOptions = {},
): Promise<Result<ReusableTaskOutput, Diagnostic[]>> {
  const full = resolve(directory);
  const blocked = await makeFolder(full);
  if (blocked !== undefined) return err([blocked]);
  return ok(
    await taskOutput({ artifacts: full, label: options.label ?? full, removeLeftovers: false }),
  );
}

/**
 * Where a `TaskOutput` writes, and whether it keeps a report there.
 *
 * `fsTaskOutput` puts artifacts and `result.json` in one folder; `fsArtworkOutput` writes the
 * artwork and no report at all (ADR 0157). Everything else about writing — the atomic rename,
 * a folder in the way answered rather than thrown — is identical, and this is the one copy of
 * it. Two adapters with their own copies would be two ways for a half-written PNG to reach a
 * watcher.
 */
interface TaskOutputDirectories {
  readonly artifacts: string;
  /** The folder `result.json` goes to, or none: the artwork is then the whole output. */
  readonly result?: string;
  readonly validate?: boolean;
  readonly label: string;
  readonly removeLeftovers: boolean;
}

async function taskOutput(directories: TaskOutputDirectories): Promise<ReusableTaskOutput> {
  const validate = directories.validate ?? true;
  // Read when the output opens, before this export can write a byte: the previous report is
  // the one record of which files in the folder are Tyto's, and `finish` replaces it.
  // No report, nothing to read: without one, Tyto cannot tell its files from anybody else's.
  const previous =
    directories.removeLeftovers && directories.result !== undefined
      ? await readPreviousDelivery(join(directories.result, RESULT_FILE))
      : ({ kind: 'none' } as const);

  return {
    async removeLeftovers(run: LeftoverRun): Promise<Diagnostics> {
      return removeLeftovers({
        previous,
        artifacts: directories.artifacts,
        // The report sits beside the artwork whenever there is one, and it is never artwork.
        protectedNames: directories.result === undefined ? [] : [RESULT_FILE],
        run,
      });
    },

    async write(artifact: Artifact): Promise<Diagnostics> {
      // ADR 0108: a folder in the way is answered and fails that one frame (exit 1); a file
      // another program holds open stays a throw, which the job rethrows (exit 2, retry).
      const blocked = await writeAtomic(join(directories.artifacts, artifact.name), artifact.bytes);
      return blocked === undefined ? [] : [blocked];
    },

    async finish(result: RenderResult): Promise<Diagnostics> {
      if (directories.result === undefined) return [];
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
      const blocked = await writeAtomic(
        join(directories.result, RESULT_FILE),
        `${JSON.stringify(result, null, 2)}\n`,
      );
      return blocked === undefined ? [] : [blocked];
    },
  };
}

/**
 * `mkdir -p`, answering `E_DELIVERY_FOLDER_BLOCKED` when a file holds a name the path needs
 * as a folder, and throwing for every other failure (TYTO-129).
 *
 * The two are different answers on purpose. A file in the way fails the same way on every
 * attempt until somebody moves it, which is exit 1 in the render contract; a folder that
 * refuses the write — permissions, a full disk — is exit 2, the code worth retrying, and
 * must stay a throw so it reaches the one place that turns a throw into that code.
 *
 * **Decided by looking, not by the error code.** The operating system's answer depends on
 * which segment is held and on the platform — Windows says `EEXIST` for a file at the last
 * segment and `ENOTDIR` for one above it, and Linux has its own mapping — so the nearest
 * entry that exists is asked what it is instead. Only when that entry is not a folder is
 * the failure the caller's to fix. `stat` and not `lstat`, because a link to a folder is a
 * folder to `mkdir`.
 *
 * `make` is the seam a test uses to stand in for a failure this machine will not produce.
 */
export async function makeFolder(
  path: string,
  make: (path: string) => Promise<unknown> = (target) => mkdir(target, { recursive: true }),
): Promise<Diagnostic | undefined> {
  try {
    await make(path);
    return undefined;
  } catch (cause) {
    for (let current = path; ; current = dirname(current)) {
      const found = await stat(current).catch(() => undefined);
      if (found !== undefined) {
        if (found.isDirectory()) throw cause;
        return diagnostic('E_DELIVERY_FOLDER_BLOCKED', { path: current });
      }
      if (dirname(current) === current) throw cause;
    }
  }
}

/**
 * Three lines naming the template, and a sentence saying it is not here.
 *
 * **A pointer, never a copy.** The template lives in a repository somebody maintains and is
 * shared by every delivery made from it; duplicating it into each folder would fill a remote
 * with copies of the same thing and make "which version is the real one" a question. What a
 * delivery owes its reader is the identity — the name and the version that produced these
 * exact files — and that fits in a line.
 *
 * Portuguese for the sentence, like `editaveis/` itself and for the same reason: it is read
 * by whoever receives the folder. The description is the template author's own words and is
 * copied as written rather than translated.
 *
 * Exported from this module and not from the package: its last writer, the delivery output,
 * went with TYTO-490's first half, and the delivery's own export decides in its second half
 * whether a delivery still says which template made it.
 */
export function templateNote(template: DeliveryTemplate): string {
  const lines = [`${template.name} ${template.version}`];
  if (template.description !== undefined) lines.push(template.description);
  lines.push(
    '',
    'O template não está nesta pasta: ele vive no repositório de templates da equipe.',
    'Estas artes foram feitas com a versão acima.',
  );
  return `${lines.join('\n')}\n`;
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
