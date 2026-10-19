import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PT_BR } from '../src/sections';

/**
 * The gallery's text is generated and compared in `tools/docs-gen`; its pictures are not,
 * because they need Chromium and the brand fonts (ADR 0102, amended by TYTO-316). So this is the
 * one place the two meet: a template the page lists with no picture is a broken image on the
 * live site, and a picture no page lists is a template that was removed and left behind.
 */

const PAGES = fileURLToPath(new URL('../pages/', import.meta.url));
const PICTURES = `${PAGES}public/template-gallery`;
const PICTURE = /\]\(\/template-gallery\/([\w-]+\.png)\)/gu;

const picturesOn = (path: string): string[] =>
  [...readFileSync(`${PAGES}${path}`, 'utf8').matchAll(PICTURE)].map(([, file]) => file ?? '');

describe.each(['templates/gallery.md', `${PT_BR}/templates/gallery.md`])('%s', (path) => {
  it('shows a picture for every template, and every picture exists', () => {
    const named = picturesOn(path);
    expect(named.length).toBeGreaterThan(0);
    for (const file of named) expect(existsSync(`${PICTURES}/${file}`), file).toBe(true);
  });
});

describe('the gallery folder', () => {
  it('holds only pictures the gallery shows', () => {
    const shown = new Set(picturesOn('templates/gallery.md'));
    const files = readdirSync(PICTURES).filter((name) => name.endsWith('.png'));
    expect(files.filter((name) => !shown.has(name))).toEqual([]);
  });
});
