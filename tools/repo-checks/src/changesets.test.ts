import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A changeset may name published packages or private ones, and never both.
 *
 * Changesets v3 treats a private package as **ignored**, and refuses a file that mixes the
 * two: `Mixed changesets that contain both ignored and not ignored packages are not allowed`.
 * There is no warning and no partial run — `changeset version` exits 1, which takes the whole
 * release workflow down.
 *
 * **It is invisible until then.** `pnpm check` does not run Changesets, `ci.yml` does not
 * either, and `release.yml` only fires on a push to `main` — so a mixed file passes every
 * check a pull request has and fails after the merge, on the branch it cannot be fixed on
 * without a second PR. That is exactly how it happened (TYTO-0, after TYTO-109): one file
 * naming `@tyto/editor` and `@tyto/desktop` together, four green checks, and a red `release`
 * on `main` twice in a row.
 *
 * Splitting is the whole fix — the same text in two files, one per side — and it costs
 * nothing, which is why this is a rule rather than a judgement call.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const WORKSPACE_GLOBS = ['packages', 'apps', 'tools'];

/** Every workspace package, by the name its manifest declares, with whether it is private. */
const packages = (): ReadonlyMap<string, boolean> => {
  const found = new Map<string, boolean>();

  for (const group of WORKSPACE_GLOBS) {
    for (const entry of readdirSync(join(repoRoot, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      let manifest: { name?: string; private?: boolean };
      try {
        manifest = JSON.parse(
          readFileSync(join(repoRoot, group, entry.name, 'package.json'), 'utf8'),
        ) as typeof manifest;
      } catch {
        // A directory with no manifest is not a package; `tools/` has a few.
        continue;
      }
      if (manifest.name !== undefined) found.set(manifest.name, manifest.private === true);
    }
  }

  return found;
};

/**
 * The package names a changeset's frontmatter declares.
 *
 * The frontmatter is the block between the first two `---` lines, one `'name': bump` per
 * line. Parsed by hand rather than with a YAML library because that is all it is, and
 * because a parser that accepted more shapes than Changesets does would pass files
 * Changesets refuses.
 */
const namesIn = (source: string): string[] => {
  const between = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(source);
  if (between === null) return [];

  return [...(between[1] ?? '').matchAll(/^\s*'([^']+)'\s*:/gmu)].map((match) => match[1] ?? '');
};

const changesetFiles = readdirSync(join(repoRoot, '.changeset')).filter(
  (file) => file.endsWith('.md') && file !== 'README.md',
);

describe('changesets', () => {
  it('name packages this workspace actually has', () => {
    // The prerequisite for the rule below meaning anything: a typo in a package name would
    // otherwise read as "not private" and pass.
    const known = packages();
    const unknown = changesetFiles.flatMap((file) =>
      namesIn(readFileSync(join(repoRoot, '.changeset', file), 'utf8'))
        .filter((name) => !known.has(name))
        .map((name) => `${file}: ${name}`),
    );

    expect(unknown).toEqual([]);
  });

  it('never mix a published package with a private one in the same file', () => {
    const known = packages();

    const mixed = changesetFiles
      .map((file) => {
        const names = namesIn(readFileSync(join(repoRoot, '.changeset', file), 'utf8'));
        const published = names.filter((name) => known.get(name) === false);
        const priv = names.filter((name) => known.get(name) === true);
        return { file, published, priv };
      })
      .filter((entry) => entry.published.length > 0 && entry.priv.length > 0)
      .map(
        (entry) =>
          `${entry.file} names published [${entry.published.join(', ')}] and private [${entry.priv.join(', ')}] — split it in two`,
      );

    expect(mixed).toEqual([]);
  });

  it('read the frontmatter the way Changesets does, both ways', () => {
    // The two assertions above pass on a correct `.changeset/` without having caught
    // anything, which is the state this repository was in the day the release broke. The
    // predicate is measured against the exact file that broke it and against its fix.
    const broken = "---\n'@tyto/editor': minor\n'@tyto/desktop': minor\n---\n\nText.\n";
    const fixed = "---\n'@tyto/editor': minor\n---\n\nText.\n";

    expect(namesIn(broken)).toEqual(['@tyto/editor', '@tyto/desktop']);
    expect(namesIn(fixed)).toEqual(['@tyto/editor']);
    expect(namesIn('no frontmatter at all')).toEqual([]);
  });

  it('know which side of the line each package is on', () => {
    // The map is what the rule is built on, so it is asserted rather than assumed: one of
    // each, named, so a workspace that made `@tyto/editor` private would fail here with the
    // reason rather than silently stop protecting anything.
    const known = packages();

    expect(known.get('@tyto/editor'), '@tyto/editor is published').toBe(false);
    expect(known.get('@tyto/desktop'), '@tyto/desktop is private').toBe(true);
  });
});
