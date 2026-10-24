import { createCommandRegistry } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import { commandOffered } from './editor-chrome.js';
import {
  type ExportPresetView,
  presetCommandTitle,
  presetExportRequest,
  registerPresetCommands,
  samePresets,
} from './export-presets.js';

/**
 * An export preset in the window (TYTO-270, ADR 0126): one command per preset, its id and
 * title, and the `export:start` request it makes. Where the box sits and what lands on disk are
 * `e2e/export-presets.desktop.test.ts`'s.
 */

/** No editor: a command that is not undoable reads the view only to compare documents. */
const NO_VIEW = { view: { state: { doc: { eq: () => true } } } } as never;

const entregas: ExportPresetView = {
  name: 'entregas',
  formats: ['grid-1x1', 'story'],
  types: ['png'],
  folder: '/work/promo/entregas',
};
const web: ExportPresetView = {
  name: 'Web e redes',
  formats: ['story'],
  types: ['webp', 'png'],
  folder: '/work/promo/web',
};

describe('one command per preset', () => {
  it('registers export.preset:<name> for each, and takes them all down again', () => {
    const registry = createCommandRegistry();
    const before = registry.list().length;
    const ran: string[] = [];
    const dispose = registerPresetCommands(registry, [entregas, web], (preset) => {
      ran.push(preset.name);
    });

    const ids = registry.list().map((command) => command.id);
    expect(ids.slice(before)).toEqual(['export.preset:entregas', 'export.preset:Web e redes']);
    expect(registry.run('export.preset:Web e redes', NO_VIEW)).toBe(true);
    expect(ran).toEqual(['Web e redes']);

    dispose();
    expect(registry.list()).toHaveLength(before);
  });

  it('is titled with the catalogue word and the name as written, in both languages', () => {
    expect(presetCommandTitle('en', 'export.preset:entregas')).toBe('Export: entregas');
    expect(presetCommandTitle('pt-BR', 'export.preset:entregas')).toBe('Exportar: entregas');
    expect(presetCommandTitle('pt-BR', 'export.preset:Web e redes')).toBe('Exportar: Web e redes');
    expect(presetCommandTitle('en', 'file.export')).toBeUndefined();
  });

  it('acts on a brief only, as the export box does (TYTO-283)', () => {
    expect(commandOffered(undefined, 'export.preset:entregas')).toBe(true);
    expect(commandOffered('preview', 'export.preset:entregas')).toBe(true);
    expect(commandOffered('settings', 'export.preset:entregas')).toBe(false);
  });
});

describe('the export a preset starts', () => {
  it('asks export:start for its formats, one output per type and its folder', () => {
    expect(presetExportRequest(web, 'doc-1', '---\ntemplate: x\n---\n')).toEqual({
      documentId: 'doc-1',
      brief: '---\ntemplate: x\n---\n',
      directory: '/work/promo/web',
      outputs: [{ kind: 'webp' }, { kind: 'png' }],
      formats: ['story'],
    });
  });

  it('re-registers only when the presets changed', () => {
    expect(samePresets([entregas], [{ ...entregas }])).toBe(true);
    expect(samePresets([entregas], [{ ...entregas, formats: ['grid-1x1'] }])).toBe(false);
  });
});
