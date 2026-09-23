import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { type Diagnostic, type Ok, diagnostic, ok } from '@tyto/core';

/**
 * Bringing a person's settings across from the version they were using before (TYTO-151,
 * ADR 0036).
 *
 * ADR 0032 gave every version its own data folder, which is right for a beta tester and wrong
 * for anybody who loses their template folder on every patch. This is the other half: on the
 * first run of a version, when its folder has none of the app's own records yet, the highest
 * older version's records are offered — once, by name — and copied if the person says yes.
 *
 * **No Electron import**, like `user-data.ts` beside it (ADR 0010). The question is asked
 * through a function the composition root hands in, which is the one part that needs a
 * `dialog`; everything that decides *whether* to ask, *what* to copy and *what a failure
 * means* is here, and asserted against real folders in a unit test.
 *
 * **Copy, never move.** The older version is still installed, may be opened again tomorrow,
 * and has to find its folder the way it left it. Nothing here writes outside the new folder.
 */

/**
 * The three records a person would miss, by file name inside a version's folder.
 *
 * `logs/` is not among them: a log is a record of *that* build's failures, and one carried
 * into a new version would date a report about this one with lines from the last.
 */
export const IMPORTED_RECORDS = ['settings.json', 'layout.json', 'recent-files.json'] as const;

/** The ciphertext folder `credential-store.ts` writes, brought across only when asked. */
export const CREDENTIALS_FOLDER = 'credentials';

/**
 * What the new folder remembers about the offer, so it is made once.
 *
 * Written on both answers. A *yes* would stop the offer anyway — the records it copies make
 * the folder no longer fresh — but a *no* leaves nothing else behind, and "never ask again for
 * this version" has to be a fact on disk rather than a property of an empty folder.
 */
export const IMPORT_RECORD = 'import.json';

/** A version folder's name, read as semver. `undefined` for anything that is not one. */
export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
}

const SEMVER =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(name: string): Version | undefined {
  const match = SEMVER.exec(name);
  if (match === null) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/**
 * Semver precedence (semver.org §11), negative when `a` comes first.
 *
 * Written out rather than taken from the `semver` package because the whole of what is
 * needed is this comparison. A prerelease comes before its release,
 * and numeric identifiers compare as numbers — `0.4.0-beta.10` is after `0.4.0-beta.9`, which
 * a string comparison gets wrong.
 */
export function compareVersions(a: Version, b: Version): number {
  const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
  if (core !== 0) return core;
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return b.prerelease.length - a.prerelease.length;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Number(left) - Number(right);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * The highest version below `current` that has a folder under `productRoot`.
 *
 * **Highest by semver, not most recently touched.** A person who opened 0.3.0 yesterday to
 * check something is still a 0.3.4 user; the folder with the newest `mtime` would bring the
 * settings of the version they looked at, not the one they work in. Folders whose names are
 * not versions are ignored, which is what a stray `Local State` or a hand-made backup folder
 * beside them should be.
 */
export async function findPreviousVersion(
  productRoot: string,
  current: string,
): Promise<string | undefined> {
  const currentVersion = parseVersion(current);
  if (currentVersion === undefined) return undefined;

  let names: string[];
  try {
    names = (await readdir(productRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return undefined;
  }

  const older = names
    .map((name) => ({ name, version: parseVersion(name) }))
    .filter(
      (candidate): candidate is { name: string; version: Version } =>
        candidate.version !== undefined && compareVersions(candidate.version, currentVersion) < 0,
    )
    .sort((a, b) => compareVersions(b.version, a.version));

  return older[0]?.name;
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const credentialFiles = async (folder: string): Promise<string[]> => {
  try {
    return (await readdir(join(folder, CREDENTIALS_FOLDER), { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

/**
 * Whether this version has not yet made any record of its own.
 *
 * **Not "the folder is empty", because it never is.** By the time `start` runs, Chromium has
 * written `Local State` and friends into it, and `start` has already logged a line — so the
 * test is the app's own records and the decision file, which are exactly the things an offer
 * would either write or be refused by.
 */
export async function isFresh(folder: string): Promise<boolean> {
  const own = [...IMPORTED_RECORDS, CREDENTIALS_FOLDER, IMPORT_RECORD];
  for (const name of own) {
    if (await exists(join(folder, name))) return false;
  }
  return true;
}

/** What there is to offer, and from where. */
export interface ImportOffer {
  /** The version the records would come from, as its folder is named. */
  readonly version: string;
  readonly folder: string;
  /** The records that exist there, which is what the question may promise. */
  readonly records: readonly string[];
  /** Whether it holds any stored credential, which is the only case the checkbox is shown. */
  readonly hasCredentials: boolean;
}

/**
 * The offer to make, or `undefined` when there is none.
 *
 * `undefined` for a folder that already has records, for a machine with no older version, and
 * for an older version that left nothing worth bringing — a question whose *yes* would copy
 * nothing is a question that teaches a person to click through the next one.
 */
export async function findOffer(inputs: {
  readonly userData: string;
  readonly productRoot: string;
  readonly version: string;
}): Promise<ImportOffer | undefined> {
  if (!(await isFresh(inputs.userData))) return undefined;
  const version = await findPreviousVersion(inputs.productRoot, inputs.version);
  if (version === undefined) return undefined;

  const folder = join(inputs.productRoot, version);
  const records: string[] = [];
  for (const name of IMPORTED_RECORDS) {
    if (await exists(join(folder, name))) records.push(name);
  }
  const hasCredentials = (await credentialFiles(folder)).length > 0;
  if (records.length === 0 && !hasCredentials) return undefined;

  return { version, folder, records, hasCredentials };
}

/** What the import did, for the log line and for a test. */
export interface ImportReport {
  /** Paths relative to the version folder, as they were written into the new one. */
  readonly copied: readonly string[];
}

const problemOf = (error: unknown): string => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (error instanceof Error) return code ?? error.message;
  return String(error);
};

/**
 * Copies what the offer named into `into`.
 *
 * **On the ok branch whatever happens** (ADR 0013): a record that could not be read, one that
 * is not JSON, or a disk that will not take a write is a `W_IMPORT_SKIPPED` beside the
 * records that did come across. A new version that refused to open because an older one had a
 * hand-edited `layout.json` would be the worst trade this card could make.
 *
 * A record is checked for being JSON before it is copied and is otherwise copied **byte for
 * byte**. Each store already reconciles what it reads against the build that reads it —
 * `layoutFrom` drops a panel this build no longer has and adds one it gained — so parsing and
 * re-serialising here would be a second, weaker copy of that rule. What is refused is only
 * what no store could read, so the new folder never starts with a file known to be garbage.
 *
 * Writes use the `wx` flag. The folder was fresh when the offer was made; if something wrote
 * a record in between, that record is newer than anything brought here and it wins.
 */
export async function importFrom(inputs: {
  readonly offer: ImportOffer;
  readonly into: string;
  readonly includeCredentials: boolean;
}): Promise<Ok<ImportReport>> {
  const { offer, into } = inputs;
  const copied: string[] = [];
  const skipped: Diagnostic[] = [];

  const skip = (item: string, problem: string): void => {
    skipped.push(diagnostic('W_IMPORT_SKIPPED', { item, version: offer.version, problem }));
  };

  const copy = async (relative: string, bytes: Buffer): Promise<void> => {
    try {
      const target = join(into, relative);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
      copied.push(relative);
    } catch (error) {
      skip(relative, `could not be written (${problemOf(error)})`);
    }
  };

  for (const name of offer.records) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(offer.folder, name));
    } catch (error) {
      skip(name, `could not be read (${problemOf(error)})`);
      continue;
    }
    try {
      JSON.parse(bytes.toString('utf8'));
    } catch {
      skip(name, 'it is not JSON, so this version would not have understood it either');
      continue;
    }
    await copy(name, bytes);
  }

  if (inputs.includeCredentials) {
    for (const name of await credentialFiles(offer.folder)) {
      const relative = `${CREDENTIALS_FOLDER}/${name}`;
      try {
        await copy(relative, await readFile(join(offer.folder, CREDENTIALS_FOLDER, name)));
      } catch (error) {
        skip(relative, `could not be read (${problemOf(error)})`);
      }
    }
  }

  return ok({ copied }, skipped);
}

/** The person's answer, as the composition root's dialog reports it. */
export interface ImportAnswer {
  readonly accept: boolean;
  /** Meaningful only when the offer had credentials and the box was ticked. */
  readonly includeCredentials: boolean;
}

/** What {@link offerPreviousVersion} ended up doing, for the log and for a test. */
export type ImportOutcome =
  | { readonly kind: 'not-offered' }
  | { readonly kind: 'declined'; readonly from: string }
  | {
      readonly kind: 'imported';
      readonly from: string;
      readonly copied: readonly string[];
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly kind: 'failed'; readonly problem: string };

/** The slice of the log this uses. */
export interface ImportLog {
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
}

/**
 * Asks once, copies on a yes, and records the answer either way.
 *
 * **Never throws.** It runs during startup, before the window exists, and anything that
 * escaped it would be `start` rejecting — the one failure TYTO-140 made visible and the one a
 * convenience must not be able to cause. An unexpected throw is logged and the version opens
 * clean, which is the same place a *no* would have left it.
 */
export async function offerPreviousVersion(inputs: {
  readonly userData: string;
  readonly productRoot: string;
  readonly version: string;
  readonly ask: (offer: ImportOffer) => Promise<ImportAnswer>;
  readonly log: ImportLog;
}): Promise<ImportOutcome> {
  try {
    const offer = await findOffer(inputs);
    if (offer === undefined) return { kind: 'not-offered' };

    const answer = await inputs.ask(offer);
    const includeCredentials = answer.accept && offer.hasCredentials && answer.includeCredentials;

    let outcome: ImportOutcome;
    if (answer.accept) {
      // Typed `Ok` rather than `Result`: there is no failure branch to read, and that is the
      // decision rather than an omission — nothing about an older folder can stop this one.
      const result = await importFrom({ offer, into: inputs.userData, includeCredentials });
      const { copied } = result.value;
      const { diagnostics } = result;
      for (const item of diagnostics) inputs.log.warn(item.message, { code: item.code });
      inputs.log.info(`brought settings across from version ${offer.version}`, { copied });
      outcome = { kind: 'imported', from: offer.version, copied, diagnostics };
    } else {
      inputs.log.info(`started fresh instead of bringing version ${offer.version}'s settings`);
      outcome = { kind: 'declined', from: offer.version };
    }

    try {
      await mkdir(inputs.userData, { recursive: true });
      await writeFile(
        join(inputs.userData, IMPORT_RECORD),
        JSON.stringify(
          {
            from: offer.version,
            answer: answer.accept ? 'imported' : 'declined',
            credentials: includeCredentials,
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch (error) {
      // The cost is being asked once more next launch, which is a nuisance and not a loss.
      inputs.log.warn('could not record the answer to the import question', {
        problem: problemOf(error),
      });
    }

    return outcome;
  } catch (error) {
    inputs.log.warn('the offer to bring the previous version’s settings failed', {
      problem: problemOf(error),
    });
    return { kind: 'failed', problem: problemOf(error) };
  }
}
