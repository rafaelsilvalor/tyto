import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

import { type Diagnostic, type Diagnostics, diagnostic } from '@tyto/core';
import type { Artifact } from '@tyto/pipeline';

import { frontmatterValues, rewriteFrontmatterValues } from './delivery-brief.js';
import type { DeliveredAsset } from './file-assets.js';
import { ASSETS_DIR } from './fs-inbox.js';

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

/** Without the dot, and matching `BRIEF_FILE`'s. */
const BRIEF_EXTENSION = 'brief';

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
 * A `TaskOutput` that can also say which template produced the artwork.
 *
 * Separate from `write` because the answer is not known when the output is opened: the job
 * resolves the template from the brief's frontmatter or the `--template` fallback while it
 * runs, so the delivery learns it between the last artifact and `finish`.
 */
/**
 * A `TaskOutput` over a folder a person reuses, which can tidy what an earlier export left.
 *
 * Separate from `finish` for `describeTemplate`'s reason: the warnings it returns belong in
 * the `result.json` that `finish` writes, so the caller needs them first.
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

export interface DeliveryOutput extends ReusableTaskOutput {
  /**
   * Writes {@link TEMPLATE_FILE}. Call it **before** `finish`, so `result.json` stays the
   * last file to appear and keeps meaning "this delivery is complete".
   */
  describeTemplate(template: DeliveryTemplate): Promise<void>;

  /**
   * Copies every image the brief resolved into `assets/` beside the artwork, points the
   * copied brief's frontmatter at them, and removes what the previous delivery's brief
   * pointed at there and this one does not (ADR 0057). Returns one warning per file
   * removed or kept. Call it **before** `finish`, for {@link describeTemplate}'s reason.
   */
  deliverAssets(assets: readonly DeliveredAsset[]): Promise<Diagnostics>;
}

export interface FsDeliveryOutputOptions {
  /**
   * The folder's name, and the copied brief's. `basename(briefPath, '.brief')` at the caller.
   *
   * One path segment: a `/` in it would silently deliver somewhere else.
   */
  readonly name: string;
  /**
   * The brief that produced the artwork, copied into {@link EDITABLE_DIR} as written until
   * {@link DeliveryOutput.deliverAssets} points its image paths at `assets/`.
   */
  readonly brief: Uint8Array;
  /**
   * `'named'`, the default, delivers into `<destination>/<name>/`: `tyto render --folder`.
   * `'destination'` delivers into `destination` itself: the desktop export box, where the
   * person picked the folder that is the delivery (ADR 0057).
   */
  readonly folder?: 'named' | 'destination';
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
  /**
   * Make {@link ReusableTaskOutput.removeLeftovers} remove what the previous export wrote
   * here and this one did not (ADR 0054). **Off by default, and off for `--out` and the
   * outbox**: that folder is the ADR 0011 contract, and its reader reconciles against
   * `result.json` itself. On for a folder a person picked and will send as it is.
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
  readonly removeLeftovers: boolean;
}

async function taskOutput(directories: TaskOutputDirectories): Promise<ReusableTaskOutput> {
  const validate = directories.validate ?? true;
  // Read when the output opens, before this export can write a byte: the previous report is
  // the one record of which files in the folder are Tyto's, and `finish` replaces it.
  const previous = directories.removeLeftovers
    ? await readPreviousDelivery(join(directories.result, RESULT_FILE))
    : ({ kind: 'none' } as const);

  return {
    async removeLeftovers(run: LeftoverRun): Promise<Diagnostics> {
      return removeLeftovers({
        previous,
        artifacts: directories.artifacts,
        // Only when the report sits beside the artwork, and then it is never artwork.
        protectedNames: directories.artifacts === directories.result ? [RESULT_FILE] : [],
        run,
      });
    },

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
 *   <format>-<NN>.png             nothing but artwork at this level
 *   editaveis/
 *     <name>.brief                the brief that produced the files above
 *     template.txt                which template made it — a pointer, never a copy
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
 ## An existing folder is reused, and only Tyto's own leftovers leave it
 *
 * Exporting the same brief twice reuses the folder and overwrites by name. A file the
 * previous export wrote and this one does not produce — `grid-03.png` after a brief went
 * from three slides to two, or `lamina-1-grid.png` after ADR 0053 renamed it — is removed
 * by `removeLeftovers`, and only if the previous `editaveis/result.json` listed it and its
 * size is still the one recorded there (ADR 0054). Nothing else in the folder is touched,
 * and every removal is a warning in the new `result.json`.
 */
export async function fsDeliveryOutput(
  destination: string,
  options: FsDeliveryOutputOptions,
): Promise<DeliveryOutput> {
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

  const folder =
    options.folder === 'destination'
      ? resolve(destination)
      : join(resolve(destination), options.name);
  const editable = join(folder, EDITABLE_DIR);
  const briefPath = join(editable, `${options.name}.${BRIEF_EXTENSION}`);
  // One `mkdir -p` makes both: `editaveis/` is inside the folder it is created under.
  await mkdir(editable, { recursive: true });

  // Read before it is replaced: the previous delivery's brief is the one record of which
  // files in `assets/` an earlier export put there (ADR 0057).
  const previousAssets = await readFile(briefPath, 'utf8').then(frontmatterValues, () => []);

  // Before any artifact, so a run that dies half way still shows what it was rendering.
  // `result.json` is the finished signal and is still the last thing written.
  await writeAtomic(briefPath, options.brief);

  return {
    ...(await taskOutput({
      artifacts: folder,
      result: editable,
      ...(options.validate === undefined ? {} : { validate: options.validate }),
      label: options.label ?? folder,
      // Always, because this layout exists to be sent as it is (ADR 0054).
      removeLeftovers: true,
    })),

    async describeTemplate(template: DeliveryTemplate): Promise<void> {
      await writeAtomic(join(editable, TEMPLATE_FILE), templateNote(template));
    },

    async deliverAssets(assets: readonly DeliveredAsset[]): Promise<Diagnostics> {
      const directory = join(folder, ASSETS_DIR);
      const names = deliveredNames(assets);
      if (names.size > 0) await mkdir(directory, { recursive: true });
      for (const [path, name] of names) await copyAtomic(path, join(directory, name));

      const renames = new Map<string, string>();
      for (const asset of assets) {
        const name = names.get(asset.path);
        if (name !== undefined) renames.set(asset.reference, name);
      }
      const source = new TextDecoder().decode(options.brief);
      await writeAtomic(briefPath, rewriteFrontmatterValues(source, renames));

      return removeAssetLeftovers(directory, previousAssets, new Set(names.values()));
    },
  };
}

/**
 * Each image's name in `assets/`: its own file name, and `-2`, `-3`… before the extension
 * when two different files share one. The same file named twice by the brief is copied once.
 * Compared without case, because a delivery is opened on filesystems that ignore it.
 */
function deliveredNames(assets: readonly DeliveredAsset[]): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const { path } of assets) {
    if (names.has(path)) continue;
    const extension = extname(path);
    const stem = basename(path, extension);
    let name = `${stem}${extension}`;
    for (let count = 2; taken.has(name.toLowerCase()); count += 1) {
      name = `${stem}-${String(count)}${extension}`;
    }
    taken.add(name.toLowerCase());
    names.set(path, name);
  }
  return names;
}

/** `writeAtomic` for a file that is already on disk: copied to `.part`, then renamed. */
async function copyAtomic(from: string, to: string): Promise<void> {
  const temporary = `${to}.part`;
  try {
    await copyFile(from, temporary);
    await rename(temporary, to);
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
}

/**
 * What the previous delivery's brief pointed at in `assets/` and this one does not: removed,
 * with a warning each (ADR 0054's rule, carried to `assets/` by ADR 0057).
 *
 * Only a bare file name counts, the only shape a delivered brief writes, so nothing outside
 * `assets/` can be named, and a file somebody else put there is left alone.
 */
async function removeAssetLeftovers(
  directory: string,
  previous: readonly string[],
  current: ReadonlySet<string>,
): Promise<Diagnostics> {
  const warnings: Diagnostic[] = [];
  for (const name of new Set(previous)) {
    const bare = name !== '' && name === basename(name) && !name.startsWith('.');
    if (!bare || current.has(name)) continue;
    const path = join(directory, name);
    const found = await lstat(path).catch(() => undefined);
    if (found?.isFile() !== true) continue;
    try {
      await rm(path);
      warnings.push(diagnostic('W_LEFTOVER_REMOVED', { file: `${ASSETS_DIR}/${name}` }));
    } catch (cause) {
      warnings.push(
        diagnostic('W_LEFTOVER_KEPT', { file: `${ASSETS_DIR}/${name}`, reason: String(cause) }),
      );
    }
  }
  return warnings;
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
