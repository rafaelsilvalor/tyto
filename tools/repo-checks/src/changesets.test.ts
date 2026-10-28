import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The two apps are versioned and the three tools are not, and what keeps each one where it
 * is differs — which is why both halves are pinned here rather than the config alone.
 *
 * `privatePackages: { version: true, tag: false }` is what puts `@tyto/cli` and
 * `@tyto/desktop` back in the release plan. Changesets v3 stopped versioning private
 * packages by default and treats one as **ignored**, so `changeset version` consumed nothing
 * that named only an app: `@tyto/cli` read `0.1.13` through eleven version PRs while
 * `@tyto/core` went `0.19.0` to `0.22.0`, nine desktop changesets accumulated, and #171
 * opened with an empty diff. Measured on the day it was turned back on — the same nine files,
 * `Packages to be bumped:` empty before and naming both apps after (TYTO-94).
 *
 * `tag: false` is the other half: `changeset git-tag` filters on it, so a private package
 * gets a version and a `CHANGELOG.md` and **no** `@tyto/<pkg>@x.y.z` ref, which is right
 * because no registry holds either app. The desktop's tag is `desktop-v*` and is pushed by
 * hand (`docs/git-workflow.md`).
 *
 * **`tools/*` stay out for a reason that is not in that config**, which is the whole point of
 * the third test. `shouldSkipPackage` ends `return !packageJson.version`, _after_ the private
 * check, so a manifest with no `version` field is skipped whatever `privatePackages` says.
 * Nothing in `.changeset/` would have to change for `@tyto/repo-checks` to start being
 * released — adding a `version` field to tidy its manifest would be enough, and Changesets,
 * `pnpm check`, `ci.yml` and `release.yml` all accept that silently.
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

/** Every manifest under one workspace root, by package name, with the `version` it declares. */
const versionsUnder = (group: string): ReadonlyMap<string, string | undefined> => {
  const found = new Map<string, string | undefined>();

  for (const entry of readdirSync(join(repoRoot, group), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest: { name?: string; version?: string };
    try {
      manifest = JSON.parse(
        readFileSync(join(repoRoot, group, entry.name, 'package.json'), 'utf8'),
      ) as typeof manifest;
    } catch {
      continue;
    }
    if (manifest.name !== undefined) found.set(manifest.name, manifest.version);
  }

  return found;
};

const changesetsConfig = JSON.parse(
  readFileSync(join(repoRoot, '.changeset', 'config.json'), 'utf8'),
) as { privatePackages?: unknown };

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
    // A typo in a package name is silent: `changeset version` skips a name it does not know,
    // so the changeset is consumed and nothing is bumped.
    const known = packages();
    const unknown = changesetFiles.flatMap((file) =>
      namesIn(readFileSync(join(repoRoot, '.changeset', file), 'utf8'))
        .filter((name) => !known.has(name))
        .map((name) => `${file}: ${name}`),
    );

    expect(unknown).toEqual([]);
  });

  it('name only packages that carry a version, or `changeset version` never consumes them', () => {
    // The same skip as the tools test below, from the other side: a changeset naming only
    // `@tyto/docs` or a `tools/*` package survives every version PR, so `changesets/action`
    // keeps reporting changesets left and never reaches the run that tags. Three such files
    // held the release after #24 and opened #208 empty (TYTO-448). `changeset-coverage.mjs`
    // refuses the branch that adds one; this catches one already on `main`.
    const unversioned = new Set(
      WORKSPACE_GLOBS.flatMap((group) =>
        [...versionsUnder(group)].filter(([, version]) => version === undefined),
      ).map(([name]) => name),
    );
    const stale = changesetFiles.flatMap((file) =>
      namesIn(readFileSync(join(repoRoot, '.changeset', file), 'utf8'))
        .filter((name) => unversioned.has(name))
        .map((name) => `${file}: ${name}`),
    );

    expect(stale).toEqual([]);
  });

  it('read the frontmatter the way Changesets does, both ways', () => {
    // The assertion above passes on a correct `.changeset/` without having caught anything,
    // so the predicate is measured against a file that names two packages and one that names
    // one — the shape that used to be refused and is legal again since TYTO-94.
    const both = "---\n'@tyto/editor': minor\n'@tyto/desktop': minor\n---\n\nText.\n";
    const one = "---\n'@tyto/editor': minor\n---\n\nText.\n";

    expect(namesIn(both)).toEqual(['@tyto/editor', '@tyto/desktop']);
    expect(namesIn(one)).toEqual(['@tyto/editor']);
    expect(namesIn('no frontmatter at all')).toEqual([]);
  });

  it('version the private apps, and tag none of them', () => {
    expect(changesetsConfig.privatePackages).toEqual({ version: true, tag: false });
  });

  it('version the apps that ship, and leave the manual out by the absence of a field', () => {
    // Both sets are pinned, so a new app cannot join either side silently. The CLI and the
    // desktop app ship binaries named after their version: `app.getVersion()` and
    // electron-builder both read `apps/desktop/package.json`, and with no version field the
    // window reported Electron's own `44.3.0` as if it were Tyto's, and the installer would
    // be named for it (TYTO-40). The manual has no version of its own: it is built from the
    // desktop app's (ADR 0101), so a field here would only put docs bumps in the version PR
    // and a changeset in every docs pull request.
    const apps = versionsUnder('apps');
    const versioned = [...apps].filter(([, version]) => version !== undefined);
    const unversioned = [...apps].filter(([, version]) => version === undefined);

    expect(versioned.map(([name]) => name).sort()).toEqual(['@tyto/cli', '@tyto/desktop']);
    for (const [name, version] of versioned) {
      expect(version, `${name} carries a version`).toMatch(/^\d+\.\d+\.\d+$/u);
    }
    expect(unversioned.map(([name]) => name).sort()).toEqual(['@tyto/docs']);
  });

  it('keep tools/* out by the absence of a version field, not by the config', () => {
    // The regression the config cannot catch. `pnpm changeset status` stays quiet about a
    // newly versioned `tools/*` package until something names it, which is the silence this
    // breaks: measured by adding `"version": "0.1.0"` here, where status reported the same two
    // apps as before and this assertion was the only thing in the repository that said so.
    const tools = versionsUnder('tools');

    expect([...tools.keys()].sort()).toEqual([
      '@tyto/contract-test',
      '@tyto/docs-gen',
      '@tyto/google-fonts-catalogue',
      '@tyto/repo-checks',
      '@tyto/template-preview',
    ]);
    expect([...tools].filter(([, version]) => version !== undefined).map(([name]) => name)).toEqual(
      [],
    );
  });

  it('know which side of the line each package is on', () => {
    // `private` still decides one thing after TYTO-94 — `tag: false` is read for private
    // packages only — so the map is asserted rather than assumed: one of each, named, so a
    // workspace that published `@tyto/desktop` fails here with the reason.
    const known = packages();

    expect(known.get('@tyto/editor'), '@tyto/editor is published').toBe(false);
    expect(known.get('@tyto/desktop'), '@tyto/desktop is private').toBe(true);
  });
});
