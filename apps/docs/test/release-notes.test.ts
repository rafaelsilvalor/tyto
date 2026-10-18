import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PT_BR, SECTIONS } from '../src/sections';

const PAGES = fileURLToPath(new URL('../pages/', import.meta.url));
const RELEASES = fileURLToPath(new URL('../../../docs/releases/', import.meta.url));

/** The release notes the repository keeps, by file name without `.md`. */
const releaseFiles = (): string[] =>
  readdirSync(RELEASES)
    .filter((file) => file.endsWith('.md'))
    .map((file) => file.slice(0, -'.md'.length));

const listed = (): string[] =>
  (SECTIONS.find((section) => section.slug === 'release-notes')?.pages ?? []).map(
    (page) => page.slug,
  );

/** `desktop-v0.7.0` → `[0, 7, 0]`, for ordering by version and not by text. */
const versionOf = (slug: string): number[] =>
  (/^desktop-v(\d+)\.(\d+)\.(\d+)$/u.exec(slug) ?? []).slice(1).map(Number);

const newerFirst = (left: string, right: string): number => {
  const [a, b] = [versionOf(left), versionOf(right)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

/**
 * The Release notes section reads the repository's `docs/releases/*.md` (TYTO-318): the text
 * published with each desktop release is written once, there, and every page here includes it.
 */
describe('the Release notes section', () => {
  it('lists one page per file in docs/releases, newest version first', () => {
    const files = releaseFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(listed()).toEqual([...files].sort(newerFirst));
  });

  it('includes each release file in both editions instead of copying it', () => {
    for (const slug of listed()) {
      const english = readFileSync(`${PAGES}release-notes/${slug}.md`, 'utf8');
      const portuguese = readFileSync(`${PAGES}${PT_BR}/release-notes/${slug}.md`, 'utf8');
      expect(english, slug).toContain(`<!--@include: ../../../../docs/releases/${slug}.md-->`);
      expect(portuguese.trim(), slug).toBe(
        `<!--@include: ../../../../../docs/releases/${slug}.md-->`,
      );
    }
  });

  it('links every listed release from both index pages', () => {
    for (const locale of ['', `${PT_BR}/`]) {
      const index = readFileSync(`${PAGES}${locale}release-notes/index.md`, 'utf8');
      for (const slug of listed()) expect(index, `${locale}${slug}`).toContain(`(./${slug})`);
    }
  });
});
