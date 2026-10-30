import { copyFile, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { type Diagnostic, type Diagnostics, type Result, diagnostic, err, ok } from '@tyto/core';
import type { Artifact } from '@tyto/pipeline';

import { isInside } from './contain.js';
import type { DeliveredAsset } from './file-assets.js';
import { ASSETS_DIR } from './fs-inbox.js';
import { type LeftoverRun, readPreviousDelivery, removeLeftovers } from './leftovers.js';
import type { OutputSink, TaskOutput } from './ports.js';
import { realOfNearest } from './real-paths.js';
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

/** A delivery's export, which can also say which template made the artwork. */
export interface DeliveryExportOutput extends ReusableTaskOutput {
  /**
   * Writes {@link TEMPLATE_FILE} beside the report. Call it **before** `finish`, so
   * `result.json` stays the last file to appear. Answers `E_OUTPUT_FILE_BLOCKED` when a folder
   * holds the name, which belongs in that `result.json`.
   */
  describeTemplate(template: DeliveryTemplate): Promise<Diagnostics>;
  /**
   * Copies every image the brief resolved that is not already inside the delivery's assets
   * folder ({@link deliveryAssetsFolder}) into it (ADR 0161). Call it **before** `finish`, for
   * {@link describeTemplate}'s reason, and only for a run that finished.
   *
   * Nothing in that folder is ever removed or replaced, and the brief is not rewritten: a file
   * already holding a copy's name is skipped in silence when its bytes are the image's, and
   * kept with `W_DELIVERY_ASSET_KEPT` when they are not. A file holding the name `assets` is
   * `E_DELIVERY_FOLDER_BLOCKED`, and a folder holding a copy's name `E_OUTPUT_FILE_BLOCKED`.
   */
  deliverAssets(assets: readonly DeliveredAsset[]): Promise<Diagnostics>;
}

export interface FsDeliveryExportOptions {
  /** The delivery's `exports` folder: the artwork, and nothing else Tyto writes. */
  readonly artwork: string;
  /** The brief's folder (`editaveis/`): `result.json` and `template.txt`. */
  readonly report: string;
  /** Named in the schema-mismatch message, so a reader knows which export produced it. */
  readonly label?: string;
}

/**
 * A delivery's export (ADR 0157 §6, TYTO-490): the artwork into the delivery's `exports`
 * folder, `result.json` and `template.txt` into its brief's folder, and the images the brief
 * uses from elsewhere into its assets folder (ADR 0161).
 *
 * ```
 * <delivery>/
 *   <format>-<NN>.png             the artwork, at `exports` (the root by default)
 *   editaveis/
 *     <name>.brief                the person's own brief, never written here
 *     result.json
 *     template.txt
 *   assets/                       the person's images; the brief's others are copied in
 * ```
 *
 * **ADR 0054's leftover rule applies to the artwork**, read from the previous `result.json`
 * in the report folder: a file that export wrote and this one did not produce is removed by
 * `removeLeftovers`, with `W_LEFTOVER_REMOVED`. The brief is the delivery's own file and is not
 * copied or rewritten; `assets/` only ever gains files (`deliverAssets`, ADR 0161).
 *
 * Both folders are made with `makeFolder`, so a file holding either name is an
 * `E_DELIVERY_FOLDER_BLOCKED` in the answer and nothing is written (TYTO-129).
 */
export async function fsDeliveryExportOutput(
  options: FsDeliveryExportOptions,
): Promise<Result<DeliveryExportOutput, Diagnostic[]>> {
  const artwork = resolve(options.artwork);
  const report = resolve(options.report);
  for (const folder of [artwork, report]) {
    const blocked = await makeFolder(folder);
    if (blocked !== undefined) return err([blocked]);
  }
  const output = await taskOutput({
    artifacts: artwork,
    result: report,
    label: options.label ?? artwork,
    removeLeftovers: true,
  });
  return ok({
    ...output,
    async describeTemplate(template: DeliveryTemplate): Promise<Diagnostics> {
      const blocked = await writeAtomic(join(report, TEMPLATE_FILE), templateNote(template));
      return blocked === undefined ? [] : [blocked];
    },
    deliverAssets: (assets) => deliverAssets(deliveryAssetsFolder(report), assets),
  });
}

/**
 * The assets folder of the delivery whose brief is kept in `briefDirectory` (ADR 0161): the
 * folder that brief already reads its images from by ADR 0057's rule. A brief in a folder
 * named `editaveis` reads `../assets`, so that one; any other reads `assets/` beside it, which
 * for a brief kept at the delivery's root (`"brief": "."`) is the root's `assets/`.
 *
 * Derived from the brief's folder rather than the delivery's root because a copy is worth
 * making only where the brief finds it: a brief in a custom `brief` folder such as `x/y`
 * gains `x/y/assets/`, the folder it searches, and not a root `assets/` it never reads.
 */
export function deliveryAssetsFolder(briefDirectory: string): string {
  const full = resolve(briefDirectory);
  return basename(full) === EDITABLE_DIR ? join(full, '..', ASSETS_DIR) : join(full, ASSETS_DIR);
}

/** `writeAtomic` for a file that is already on disk: copied to `.part`, then renamed. */
async function copyAtomic(from: string, to: string): Promise<Diagnostic | undefined> {
  return placeAtomic(to, (temporary) => copyFile(from, temporary));
}

/**
 * ADR 0161's copy. An image whose real path is already inside `directory`, at any depth, is
 * the person's and is left where it is; every other one is copied under
 * {@link deliveredNames}'s name, unless a file there already holds that name.
 *
 * Real paths on both sides, so a brief that reaches `assets/` through `../assets`, a junction
 * or a differently spelt path is still recognised as inside, and a link inside `assets/` that
 * leads out is copied rather than trusted to stay.
 */
async function deliverAssets(
  directory: string,
  assets: readonly DeliveredAsset[],
): Promise<Diagnostics> {
  const real = await realOfNearest(directory);
  const outside: DeliveredAsset[] = [];
  for (const asset of assets) {
    if (!isInside(real, await realOfNearest(asset.path))) outside.push(asset);
  }
  const names = deliveredNames(outside);
  if (names.size === 0) return [];
  const held = await makeFolder(directory);
  if (held !== undefined) return [held];

  const answers: Diagnostic[] = [];
  for (const [path, { name, source }] of names) {
    const target = join(directory, name);
    const there = await sameFile(path, target);
    // The same bytes under the same name: already delivered, by an earlier export or by hand.
    if (there === 'same') continue;
    // The person's file, never replaced: theirs is the one they work from (ADR 0161).
    if (there === 'different') {
      answers.push(diagnostic('W_DELIVERY_ASSET_KEPT', { path: target, source }));
      continue;
    }
    const blocked = await copyAtomic(path, target);
    if (blocked !== undefined) answers.push(blocked);
  }
  return answers;
}

/**
 * Whether `target` holds `source`'s bytes. `absent` covers anything that is not a plain file,
 * so a folder in the way reaches `copyAtomic` and is answered there with its own code.
 * Sizes first, because a different size settles it without reading either image.
 */
async function sameFile(source: string, target: string): Promise<'absent' | 'same' | 'different'> {
  const found = await lstat(target).catch(() => undefined);
  if (found === undefined || !found.isFile()) return 'absent';
  if (found.size !== (await stat(source)).size) return 'different';
  const [left, right] = await Promise.all([readFile(source), readFile(target)]);
  return left.equals(right) ? 'same' : 'different';
}

const DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/iu;
const LONGEST_FETCHED_STEM = 64;

/**
 * The stem a fetched image is copied under, from its reference (ADR 0118).
 *
 * Its cached file is named by a hash, which says nothing to the person opening `assets/`,
 * and the reference — `test:logo`, `drive:pasta/Logo Final` — is not a file name on every
 * system. So the text after the reference's last `/`, `\` or `:` is kept, with every
 * character outside `[A-Za-z0-9._-]` turned into `-`, its own extension dropped (the cached
 * type gives the extension), leading and trailing dots removed, and at most 64 characters.
 * A device name gains `-image`. Nothing left is the scheme, which is always a name.
 *
 * The reference is text from a brief, and this is the only place it becomes part of a path:
 * nothing it holds can name a folder, because every separator is cut before it is used.
 */
function fetchedStem(reference: string): string {
  const scheme = reference.slice(0, reference.indexOf(':'));
  const last = reference.split(/[/\\:]/u).pop() ?? '';
  const safe = last.replace(/[^A-Za-z0-9._-]/gu, '-');
  const stem = basename(safe, extname(safe))
    .replace(/^\.+|\.+$/gu, '')
    .slice(0, LONGEST_FETCHED_STEM);
  const name = stem === '' ? scheme : stem;
  return DEVICE_NAME.test(name) ? `${name}-image` : name;
}

/**
 * Each image's name in `assets/`, and what a warning calls it: its own file name, and `-2`,
 * `-3`… before the extension when two different files of this run share one. The same file
 * named twice by the brief is copied once. Compared without case, because a delivery is
 * opened on filesystems that ignore it. An image a plugin supplied is named after its
 * reference instead of its cached file, and a warning names it by that reference too.
 */
function deliveredNames(
  assets: readonly DeliveredAsset[],
): Map<string, { readonly name: string; readonly source: string }> {
  const names = new Map<string, { readonly name: string; readonly source: string }>();
  const taken = new Set<string>();
  for (const { path, reference, fetched } of assets) {
    if (names.has(path)) continue;
    const extension = extname(path);
    const stem = fetched === true ? fetchedStem(reference) : basename(path, extension);
    let name = `${stem}${extension}`;
    for (let count = 2; taken.has(name.toLowerCase()); count += 1) {
      name = `${stem}-${String(count)}${extension}`;
    }
    taken.add(name.toLowerCase());
    names.set(path, { name, source: fetched === true ? reference : path });
  }
  return names;
}

/**
 * Where a `TaskOutput` writes, and whether it keeps a report there.
 *
 * `fsTaskOutput` puts artifacts and `result.json` in one folder; `fsArtworkOutput` writes the
 * artwork and no report at all; `fsDeliveryExportOutput` puts the report in the brief's folder,
 * apart from the artwork (ADR 0157). Everything else about writing — the atomic rename,
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
        // A report is never artwork, wherever it sits.
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

 */
function templateNote(template: DeliveryTemplate): string {
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
