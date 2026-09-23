import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileCredentialStore } from './credential-store.js';
import { type SafeStorage, createCredentials } from './credentials.js';
import { fileLayoutStore } from './layout-store.js';
import {
  IMPORT_RECORD,
  type ImportAnswer,
  type ImportLog,
  type ImportOffer,
  compareVersions,
  findPreviousVersion,
  offerPreviousVersion,
  parseVersion,
} from './previous-version.js';
import { fileRecentFiles } from './recent-files.js';
import { fileSettingsStore } from './settings-store.js';

/**
 * The import against real folders (TYTO-151, ADR 0036).
 *
 * A real disk rather than a double, for the reason `recent-files.test.ts` gives: everything
 * interesting here is about what a folder can be — absent, half there, hand-edited, holding a
 * directory where a file should be. The records are written and read back through the same
 * stores the app uses, so "the same templates folder, layout and recent list" is asserted in
 * the terms the app itself reads them in, not as bytes somebody promised were equivalent.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tyto-import-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const folder = (version: string): string => {
  const path = join(root, version);
  mkdirSync(path, { recursive: true });
  return path;
};

/** Every file under `path` with its bytes, so "untouched" is a comparison and not a glance. */
const snapshot = (path: string): Record<string, string> => {
  const files: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[relative(path, full).replaceAll('\\', '/')] = readFileSync(full, 'base64');
    }
  };
  walk(path);
  return files;
};

/** An older version a person actually used: a folder picked, panels moved, two briefs opened. */
const seedOlder = async (version: string): Promise<string> => {
  const path = folder(version);
  await fileSettingsStore(join(path, 'settings.json')).write({
    templatesFolder: join('D:', 'work', 'templates'),
  });
  const layouts = fileLayoutStore(join(path, 'layout.json'));
  const layout = await layouts.read();
  await layouts.write({
    panels: layout.panels.map((panel) => ({ ...panel, size: panel.size + 7, open: true })),
  });
  const recent = fileRecentFiles(join(path, 'recent-files.json'));
  await recent.remember({ path: join('D:', 'work', 'a.brief'), name: 'a.brief' });
  await recent.remember({ path: join('D:', 'work', 'b.brief'), name: 'b.brief' });
  mkdirSync(join(path, 'logs'), { recursive: true });
  writeFileSync(join(path, 'logs', 'tyto.log'), 'a line from that build\n');
  return path;
};

/** A reversible stand-in: the routing is what is under test, not DPAPI. */
const encryption: SafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from(`sealed:${text}`, 'utf8'),
  decryptString: (bytes) => bytes.toString('utf8').replace(/^sealed:/, ''),
};

const credentialsIn = (path: string) =>
  createCredentials({ encryption, store: fileCredentialStore(join(path, 'credentials')) });

interface Recorded {
  readonly offers: ImportOffer[];
  readonly warnings: string[];
  readonly log: ImportLog;
}

const recorder = (): Recorded => {
  const offers: ImportOffer[] = [];
  const warnings: string[] = [];
  return {
    offers,
    warnings,
    log: { info: () => undefined, warn: (message) => warnings.push(message) },
  };
};

const run = (version: string, answer: ImportAnswer, recorded = recorder()) =>
  offerPreviousVersion({
    userData: folder(version),
    productRoot: root,
    version,
    log: recorded.log,
    ask: async (offer) => {
      recorded.offers.push(offer);
      return answer;
    },
  });

const yes: ImportAnswer = { accept: true, includeCredentials: false };
const no: ImportAnswer = { accept: false, includeCredentials: false };

describe('which version is offered', () => {
  it('orders by semver, prereleases before their release and numbers as numbers', () => {
    const sorted = ['0.10.0', '0.4.0', '0.4.0-beta.10', '0.4.0-beta.9', '0.4.0-alpha', '0.3.4']
      .map((name) => ({ name, version: parseVersion(name)! }))
      .sort((a, b) => compareVersions(a.version, b.version))
      .map(({ name }) => name);

    expect(sorted).toEqual([
      '0.3.4',
      '0.4.0-alpha',
      '0.4.0-beta.9',
      '0.4.0-beta.10',
      '0.4.0',
      '0.10.0',
    ]);
  });

  it('takes the highest older version, not the most recently touched', async () => {
    folder('0.3.3');
    folder('0.2.9');
    folder('not-a-version');
    folder('0.9.0');
    // Written last, so it is the newest folder on disk — and still not the answer.
    folder('0.3.0');

    expect(await findPreviousVersion(root, '0.3.4')).toBe('0.3.3');
  });

  it('offers nothing on a machine with no older version', async () => {
    await seedOlder('0.5.0');
    const recorded = recorder();

    expect(await run('0.3.4', yes, recorded)).toEqual({ kind: 'not-offered' });
    expect(recorded.offers).toEqual([]);
  });

  it('offers nothing when the older version left nothing worth bringing', async () => {
    mkdirSync(join(folder('0.3.3'), 'logs'));
    const recorded = recorder();

    expect(await run('0.3.4', yes, recorded)).toEqual({ kind: 'not-offered' });
    expect(recorded.offers).toEqual([]);
  });

  it('offers nothing to a version that already has records of its own', async () => {
    await seedOlder('0.3.3');
    writeFileSync(join(folder('0.3.4'), 'layout.json'), '{}');
    const recorded = recorder();

    expect(await run('0.3.4', yes, recorded)).toEqual({ kind: 'not-offered' });
    expect(recorded.offers).toEqual([]);
  });

  it('ignores what Chromium and the log put in the new folder before the question', async () => {
    await seedOlder('0.3.3');
    const fresh = folder('0.3.4');
    writeFileSync(join(fresh, 'Local State'), '{}');
    mkdirSync(join(fresh, 'logs'));
    writeFileSync(join(fresh, 'logs', 'tyto.log'), 'app started\n');

    expect((await run('0.3.4', no)).kind).toBe('declined');
  });
});

describe('saying yes', () => {
  it('produces the same templates folder, layout and recent list', async () => {
    const older = await seedOlder('0.3.3');

    const outcome = await run('0.3.4', yes);
    const newer = join(root, '0.3.4');

    expect(outcome).toMatchObject({ kind: 'imported', from: '0.3.3', diagnostics: [] });
    expect(await fileSettingsStore(join(newer, 'settings.json')).read()).toEqual(
      await fileSettingsStore(join(older, 'settings.json')).read(),
    );
    expect(await fileLayoutStore(join(newer, 'layout.json')).read()).toEqual(
      await fileLayoutStore(join(older, 'layout.json')).read(),
    );
    expect(await fileRecentFiles(join(newer, 'recent-files.json')).list()).toEqual(
      await fileRecentFiles(join(older, 'recent-files.json')).list(),
    );
    // Neither record is the default, so the comparisons above are not two defaults agreeing.
    expect(await fileSettingsStore(join(newer, 'settings.json')).read()).toEqual({
      templatesFolder: join('D:', 'work', 'templates'),
    });
    expect(await fileLayoutStore(join(newer, 'layout.json')).read()).not.toEqual(
      await fileLayoutStore(join(root, 'nowhere.json')).read(),
    );
  });

  it('does not bring the log, which is that build’s and not this one’s', async () => {
    await seedOlder('0.3.3');

    await run('0.3.4', yes);

    expect(
      Object.keys(snapshot(join(root, '0.3.4'))).filter((path) => path.startsWith('logs/')),
    ).toEqual([]);
  });

  it('copies and never moves: the older folder is byte-for-byte what it was', async () => {
    const older = await seedOlder('0.3.3');
    await credentialsIn(older).set('drive', 'the-token');
    const before = snapshot(older);

    await run('0.3.4', { accept: true, includeCredentials: true });

    expect(snapshot(older)).toEqual(before);
  });

  it('is asked once: a second launch finds records and does not ask', async () => {
    await seedOlder('0.3.3');
    await run('0.3.4', yes);
    const recorded = recorder();

    expect(await run('0.3.4', yes, recorded)).toEqual({ kind: 'not-offered' });
    expect(recorded.offers).toEqual([]);
  });
});

describe('saying no', () => {
  it('leaves the new version clean and records the answer there', async () => {
    await seedOlder('0.3.3');

    expect(await run('0.3.4', no)).toEqual({ kind: 'declined', from: '0.3.3' });
    const newer = join(root, '0.3.4');
    expect(Object.keys(snapshot(newer))).toEqual([IMPORT_RECORD]);
    expect(JSON.parse(readFileSync(join(newer, IMPORT_RECORD), 'utf8'))).toEqual({
      from: '0.3.3',
      answer: 'declined',
      credentials: false,
    });
  });

  it('does not ask again for this version', async () => {
    await seedOlder('0.3.3');
    await run('0.3.4', no);
    const recorded = recorder();

    expect(await run('0.3.4', yes, recorded)).toEqual({ kind: 'not-offered' });
    expect(recorded.offers).toEqual([]);
  });
});

describe('credentials', () => {
  it('says whether there are any, which is when the checkbox is shown', async () => {
    const older = await seedOlder('0.3.3');
    const recorded = recorder();
    await run('0.3.4', no, recorded);
    expect(recorded.offers[0]?.hasCredentials).toBe(false);

    rmSync(join(root, '0.3.4'), { recursive: true });
    await credentialsIn(older).set('drive', 'the-token');
    const again = recorder();
    await run('0.3.4', no, again);
    expect(again.offers[0]?.hasCredentials).toBe(true);
  });

  it('stay behind on a yes when the box was left unticked', async () => {
    const older = await seedOlder('0.3.3');
    await credentialsIn(older).set('drive', 'the-token');

    await run('0.3.4', { accept: true, includeCredentials: false });

    expect(await credentialsIn(join(root, '0.3.4')).get('drive')).toBeNull();
    expect(JSON.parse(readFileSync(join(root, '0.3.4', IMPORT_RECORD), 'utf8'))).toMatchObject({
      answer: 'imported',
      credentials: false,
    });
  });

  it('come across, and still decrypt, only when the box was ticked', async () => {
    const older = await seedOlder('0.3.3');
    await credentialsIn(older).set('drive', 'the-token');

    const outcome = await run('0.3.4', { accept: true, includeCredentials: true });

    expect(outcome).toMatchObject({ kind: 'imported', diagnostics: [] });
    expect(await credentialsIn(join(root, '0.3.4')).get('drive')).toBe('the-token');
  });

  it('never travel on a no, whatever the box said', async () => {
    const older = await seedOlder('0.3.3');
    await credentialsIn(older).set('drive', 'the-token');

    await run('0.3.4', { accept: false, includeCredentials: true });

    expect(await credentialsIn(join(root, '0.3.4')).get('drive')).toBeNull();
  });
});

describe('a broken older folder', () => {
  it('brings what it can and names what it could not, on the ok branch', async () => {
    const older = await seedOlder('0.3.3');
    writeFileSync(join(older, 'settings.json'), '{"templatesFolder": ');
    rmSync(join(older, 'layout.json'));
    mkdirSync(join(older, 'layout.json'));
    const recorded = recorder();

    const outcome = await run('0.3.4', yes, recorded);

    expect(outcome.kind).toBe('imported');
    if (outcome.kind !== 'imported') return;
    expect(outcome.copied).toEqual(['recent-files.json']);
    expect(outcome.diagnostics.map((item) => [item.code, item.severity])).toEqual([
      ['W_IMPORT_SKIPPED', 'warning'],
      ['W_IMPORT_SKIPPED', 'warning'],
    ]);
    expect(outcome.diagnostics[0]?.message).toContain("'settings.json'");
    expect(outcome.diagnostics[0]?.message).toContain('0.3.3');
    expect(outcome.diagnostics[1]?.message).toContain("'layout.json'");
    // What could not be read reaches the log, which is where a tester's report comes from.
    expect(recorded.warnings).toEqual(outcome.diagnostics.map((item) => item.message));
    // And the new version still reads its defaults for what did not come across.
    expect(await fileSettingsStore(join(root, '0.3.4', 'settings.json')).read()).toEqual({
      templatesFolder: null,
    });
  });

  it('does not stop the new version when the question itself fails', async () => {
    await seedOlder('0.3.3');
    const recorded = recorder();

    const outcome = await offerPreviousVersion({
      userData: folder('0.3.4'),
      productRoot: root,
      version: '0.3.4',
      log: recorded.log,
      ask: () => Promise.reject(new Error('no display')),
    });

    expect(outcome).toEqual({ kind: 'failed', problem: 'no display' });
    expect(recorded.warnings).toHaveLength(1);
  });

  it('offers nothing when the product root does not exist', async () => {
    const outcome = await offerPreviousVersion({
      userData: join(root, 'missing', '0.3.4'),
      productRoot: join(root, 'missing'),
      version: '0.3.4',
      log: recorder().log,
      ask: () => Promise.resolve(yes),
    });

    expect(outcome).toEqual({ kind: 'not-offered' });
  });
});
