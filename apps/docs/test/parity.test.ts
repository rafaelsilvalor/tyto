import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ENGLISH_ONLY_PAGES, PT_BR, SECTIONS } from '../src/sections';

const PAGES = fileURLToPath(new URL('../pages/', import.meta.url));

/** Every Markdown page under `pages/`, as a forward-slash path relative to it. */
const allPages = (): string[] =>
  readdirSync(PAGES, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => path.endsWith('.md'))
    .sort();

const pages = allPages();
const english = pages.filter((path) => !path.startsWith(`${PT_BR}/`));
const portuguese = pages
  .filter((path) => path.startsWith(`${PT_BR}/`))
  .map((path) => path.slice(PT_BR.length + 1));

/**
 * ADR 0101: a page in one edition exists in the other. The pt-BR one may lag in wording,
 * never in structure — a page missing from either side is a reader who follows the
 * language switcher into a 404.
 */
describe('the two editions have the same pages', () => {
  it('every English page has a pt-BR page, except the English-only author guides', () => {
    const translatable = english.filter((path) => !ENGLISH_ONLY_PAGES.includes(path));
    expect(portuguese).toEqual(translatable);
  });

  it('every English-only page exists in English and not in pt-BR', () => {
    for (const path of ENGLISH_ONLY_PAGES) {
      expect(english).toContain(path);
      expect(portuguese).not.toContain(path);
    }
  });

  it('every section of the navigation has a page in each edition', () => {
    for (const section of SECTIONS) {
      expect(english).toContain(`${section.slug}/index.md`);
      expect(portuguese).toContain(`${section.slug}/index.md`);
    }
  });

  it('every page a section lists in the sidebar exists in each edition', () => {
    const listed = SECTIONS.flatMap((section) =>
      (section.pages ?? []).map((page) => `${section.slug}/${page.slug}.md`),
    );
    expect(listed.length).toBeGreaterThan(0);
    for (const path of listed) {
      expect(english).toContain(path);
      expect(portuguese).toContain(path);
    }
  });
});
