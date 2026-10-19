import { readFile, readdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseBrief } from '@tyto/brief-lang';
import {
  type Diagnostic,
  compile,
  createFaceCache,
  describeFace,
  loadFormats,
  loadTemplateRegistry,
  resolve,
} from '@tyto/core';
import { createFontLibrary } from '@tyto/fonts';
import { fileAssetResolver, nodeFileSystem } from '@tyto/io';
import { markupTemplateSource } from '@tyto/pipeline';
import { beforeAll, describe, expect, it } from 'vitest';

import { PT_BR } from '../src/sections';

/**
 * Every brief the Briefs and Templates pages show is a file under `examples/briefs/`, pulled in
 * with `<<< @/../examples/briefs/<name>.brief`, and this compiles each one against the manual's
 * own template, `examples/templates/notice` (TYTO-316). So a page cannot show a brief that does
 * not compile, and both editions show the same bytes.
 *
 * In-process and through the packages' public entry points, the way `apps/cli` composes them,
 * short of writing bytes: this checks the language, not the raster.
 */

const EXAMPLES = fileURLToPath(new URL('../examples/', import.meta.url));
const BRIEFS = `${EXAMPLES}briefs`;
const TEMPLATES = `${EXAMPLES}templates`;
const PAGES = fileURLToPath(new URL('../pages/', import.meta.url));
const BUILT_IN_FORMATS = fileURLToPath(
  new URL('../../../packages/templates/templates/formats.yaml', import.meta.url),
);
const BRIEF_LANGUAGE_DOC = fileURLToPath(
  new URL('../../../docs/brief-language.md', import.meta.url),
);

/** The sections whose pages teach briefs, and so may show one only as an imported file. */
const TEACHING_SECTIONS = ['briefs', 'templates'];

const IMPORT = /^<<< @\/\.\.\/examples\/briefs\/([\w-]+\.brief)/gmu;

const fileSystem = nodeFileSystem();
// No folders: every machine measures with the bundled faces only, as CI does (ADR 0037).
const faces = createFaceCache(
  createFontLibrary({ describe: describeFace, directories: [] }).source,
);

let formats: Awaited<ReturnType<typeof loadFormats>>;

beforeAll(async () => {
  formats = await loadFormats(fileSystem, BUILT_IN_FORMATS);
});

/** Every diagnostic, of any severity, from parsing a brief to its Scene. */
async function diagnosticsOf(source: string): Promise<readonly Diagnostic[]> {
  if (!formats.ok) return formats.error;

  const ast = parseBrief(source);
  if (!ast.ok) return ast.error;

  const registry = await loadTemplateRegistry(fileSystem, TEMPLATES);
  if (!registry.ok) return registry.error;
  if (registry.value.failures.length > 0) {
    return registry.value.failures.flatMap((failure) => failure.diagnostics);
  }

  const resolved = await resolve(ast.value, {
    registry: registry.value,
    assets: fileAssetResolver({ base: BRIEFS }),
  });
  if (!resolved.ok) return resolved.error;

  const template = await markupTemplateSource(fileSystem, registry.value).load('notice');
  if (!template.ok) return template.error;

  const scene = compile(resolved.value, template.value, { formats: formats.value, faces });
  if (!scene.ok) return [...resolved.diagnostics, ...scene.error];

  return [...resolved.diagnostics, ...ast.diagnostics, ...scene.diagnostics];
}

const describeAll = (items: readonly Diagnostic[]): string[] =>
  items.map((item) => `${item.code}: ${item.message}`);

const briefFiles = readdirSync(BRIEFS)
  .filter((name) => name.endsWith('.brief'))
  .sort();

/** Every Markdown page of the teaching sections, with its edition. */
const teachingPages = readdirSync(PAGES, { recursive: true, encoding: 'utf8' })
  .map((path) => path.replaceAll('\\', '/'))
  .filter((path) => path.endsWith('.md'))
  .filter((path) => {
    const inEdition = path.startsWith(`${PT_BR}/`) ? path.slice(PT_BR.length + 1) : path;
    return TEACHING_SECTIONS.some((section) => inEdition.startsWith(`${section}/`));
  });

describe.each(briefFiles)('examples/briefs/%s', (name) => {
  it('compiles against the manual’s template with no error and no warning', async () => {
    const source = await readFile(`${BRIEFS}/${name}`, 'utf8');
    expect(describeAll(await diagnosticsOf(source))).toEqual([]);
  });
});

describe('the pages show briefs only as compiled files', () => {
  it('has examples to compile', () => {
    expect(briefFiles.length).toBeGreaterThan(0);
  });

  it.each(teachingPages)('%s imports only briefs that exist, and writes none inline', (path) => {
    const markdown = readFileSync(`${PAGES}${path}`, 'utf8');
    for (const [, file] of markdown.matchAll(IMPORT)) expect(briefFiles).toContain(file);

    // A fenced block that holds a directive or a `template:` line is a brief nobody compiled.
    // Fences only: inline code such as `::lamina` names a directive, it does not show a brief.
    const fences = [...markdown.matchAll(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1/gmu)];
    const inline = fences.filter(([, , body = '']) => /^(::\S|template:)/mu.test(body));
    expect(inline.map(([block]) => block)).toEqual([]);
  });

  it('shows every example in both editions', () => {
    for (const edition of ['en', PT_BR]) {
      const shown = new Set(
        teachingPages
          .filter((path) => path.startsWith(`${PT_BR}/`) === (edition === PT_BR))
          .flatMap((path) =>
            [...readFileSync(`${PAGES}${path}`, 'utf8').matchAll(IMPORT)].map(([, file]) => file),
          ),
      );
      expect([...shown].sort(), edition).toEqual(briefFiles);
    }
  });
});

describe('the example in docs/brief-language.md', () => {
  it('compiles against the same template, with its assets read beside the examples', async () => {
    const markdown = await readFile(BRIEF_LANGUAGE_DOC, 'utf8');
    const example = /```brief\n([\s\S]*?)```/u.exec(markdown)?.[1];
    expect(example).toBeDefined();
    expect(describeAll(await diagnosticsOf(example ?? ''))).toEqual([]);
  });
});

describe('the manual’s template', () => {
  it('is the only template in its folder, so an example cannot quietly name another', async () => {
    const entries = await readdir(TEMPLATES);
    expect(entries).toEqual(['notice']);
  });
});
