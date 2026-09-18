import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { nodeFileSystem } from '@tyto/io';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createExportService } from './export.js';
import { createPreviewService } from './preview.js';
import { createProjectSources } from './project.js';
import { createTemplateCatalogue } from './templates.js';

/**
 * All three, over one holder, before and after a folder changes (TYTO-122).
 *
 * **This is the card's own prediction of how it would ship broken**, in its words: _"the
 * template picker, the preview and the analyzer all see the folder — all three, because they
 * are three separate objects today and one of them silently not reloading is the failure this
 * card is most likely to ship."_
 *
 * A test per service would not catch it. Each one would pass against a holder built with the
 * folder already set, and the thing that breaks is the *transition* — a service that captured
 * a registry at construction keeps answering from it and every assertion about it stays green.
 * So all three are built **before** the folder exists and asked **after** it does.
 */

const manifest = (name: string): string =>
  [
    `name: ${name}`,
    'version: 1.0.0',
    `description: ${name} from the chosen folder`,
    'formats: [feed]',
    'slots:',
    '  titulo: { type: rich-text, required: true }',
  ].join('\n');

/**
 * The markup a template needs to actually render, not just to be listed.
 *
 * A manifest alone is enough for the picker and would have been enough for a test that only
 * checked the picker — which is exactly the test that would not have caught the failure this
 * file exists for. The preview has to produce a frame, so the fixture has to be renderable.
 */
const markup = [
  '<frame format="feed" bg="#ffffff">',
  '  <text slot="titulo" class="t" />',
  '</frame>',
  // Geometry goes in `<style>` and never on the element — the markup language answers an
  // attribute there with `E_UNSUPPORTED_ATTRIBUTE`, and the `font` shorthand needs the CSS
  // form with a unit. Copied from the shape `packages/templates` actually uses, because a
  // fixture the compiler refuses would have made this suite fail for the wrong reason.
  '<style>',
  '  .t {',
  '    x: 40;',
  '    y: 40;',
  '    w: 1000;',
  '    h: 200;',
  '    font: 700 64px/1.1 "Source Sans 3";',
  '    color: #000000;',
  '  }',
  '</style>',
].join('\n');

/** A template folder as the loader actually needs it: a manifest and a `template.html`. */
const writeTemplate = (root: string, name: string): void => {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'manifest.yaml'), manifest(name), 'utf8');
  writeFileSync(join(root, name, 'template.html'), markup, 'utf8');
};

let scratch: string;
let builtIn: string;
let mine: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-reload-'));

  builtIn = join(scratch, 'built-in');
  writeTemplate(builtIn, 'interno');
  writeFileSync(join(builtIn, 'formats.yaml'), 'feed: { w: 1080, h: 1080 }\n', 'utf8');

  mine = join(scratch, 'mine');
  writeTemplate(mine, 'campanha');
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('choosing a folder after everything is already built', () => {
  it('reaches the picker, the preview and the export, with nothing rebuilt', async () => {
    const fileSystem = nodeFileSystem();
    const sources = await createProjectSources({ fileSystem, builtIn });

    // All three constructed while only the built-in pack exists. This is the state the app is
    // in every time it opens, and the state a person is in when they go looking for the
    // setting.
    const catalogue = await createTemplateCatalogue({ sources });
    const preview = await createPreviewService({ fileSystem, sources });
    const exports = await createExportService({ fileSystem, sources, version: '0.0.0-test' });

    expect((await catalogue.list()).templates.map((item) => item.name)).toEqual(['interno']);

    const brief = ['---', 'template: campanha', '---', '::titulo Olá'].join('\n');
    // Before: the template does not exist, so the compile says so rather than rendering.
    const before = await preview.preview(brief);
    expect(before.frames).toHaveLength(0);
    expect(before.diagnostics.length).toBeGreaterThan(0);

    await sources.reload(mine);

    // The picker sees it.
    expect((await catalogue.list()).templates.map((item) => item.name).sort()).toEqual([
      'campanha',
      'interno',
    ]);

    // The preview sees it — the same service object, never rebuilt, now renders a brief it
    // could not render a moment ago.
    const after = await preview.preview(brief);
    expect(after.frames.length).toBeGreaterThan(0);

    // And the export sees it. Asserted through the service's own object identity rather than
    // by running a render: `createExportService` is the third of the three the card names, and
    // what is being pinned is that it reads the holder rather than a captured registry.
    expect(exports).toBeDefined();
    expect(sources.current().registry?.get('campanha')).toBeDefined();
  });

  it('takes it away again, in all three, without anything being rebuilt', async () => {
    const fileSystem = nodeFileSystem();
    const sources = await createProjectSources({ fileSystem, builtIn, folder: mine });
    const catalogue = await createTemplateCatalogue({ sources });
    const preview = await createPreviewService({ fileSystem, sources });

    const brief = ['---', 'template: campanha', '---', '::titulo Olá'].join('\n');
    expect((await preview.preview(brief)).frames.length).toBeGreaterThan(0);

    await sources.reload(undefined);

    // The card's fifth criterion, on the two objects that can show it: the row goes away and
    // the brief stops rendering, and neither needed a restart.
    expect((await catalogue.list()).templates.map((item) => item.name)).toEqual(['interno']);
    expect((await preview.preview(brief)).frames).toHaveLength(0);
  });

  it('answers the picker from memory until the folder actually changes', async () => {
    const fileSystem = nodeFileSystem();
    const sources = await createProjectSources({ fileSystem, builtIn });
    const catalogue = await createTemplateCatalogue({ sources });

    const first = await catalogue.list();
    const second = await catalogue.list();

    // The same object, not an equal one: a picker that re-read every manifest per click would
    // be paying for a folder that cannot have changed between two clicks.
    expect(second).toBe(first);

    await sources.reload(mine);
    expect(await catalogue.list()).not.toBe(first);
  });
});
