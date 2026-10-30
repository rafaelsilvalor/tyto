import { describe, expect, it } from 'vitest';

import {
  type GalleryIndex,
  galleryStatus,
  parseGalleryIndex,
  sameRepository,
} from './gallery-index.js';
import { EMPTY_PLUGIN_FILES_LOCK, parsePluginFile } from './plugin-files.js';

/** Three entries, as the card's acceptance asks: one per state a machine can be in. */
const INDEX = `version: 1
entries:
  - id: tabela
    kind: template
    name: Tabela
    description: A table in one image.
    source: { git: https://git.example.com/tyto-template-tabela.git }
    latest: v1.2.0
    templates: [tabela]
    configurations: [roxo]
    preview: previews/tabela.png
    engine: '>=0.1.0'
    changes: Wider first column.
  - id: agenda
    kind: template
    name: Agenda
    description: The week's classes.
    source: { git: https://git.example.com/tyto-template-agenda }
    latest: v2.0.0
    templates: [agenda]
    engine: '>=0.1.0'
  - id: inbox
    kind: plugin
    name: Inbox
    description: Reads briefs from a folder.
    source: { git: https://git.example.com/tyto-plugin-inbox.git }
    latest: v0.3.0
    engine: '>=0.1.0'
`;

function index(text = INDEX): GalleryIndex {
  const read = parseGalleryIndex(text, 'index.yaml');
  expect(read.diagnostics).toEqual([]);
  if (read.value === undefined) throw new Error('the index did not read');
  return read.value;
}

describe('parseGalleryIndex', () => {
  it('reads every entry with its fields', () => {
    const [tabela, agenda, inbox] = index().entries;
    expect(tabela).toMatchObject({
      id: 'tabela',
      kind: 'template',
      git: 'https://git.example.com/tyto-template-tabela.git',
      latest: 'v1.2.0',
      templates: ['tabela'],
      configurations: ['roxo'],
      preview: 'previews/tabela.png',
      engine: '>=0.1.0',
      changes: 'Wider first column.',
    });
    expect(agenda?.configurations).toEqual([]);
    expect(inbox).toMatchObject({ kind: 'plugin', templates: [] });
  });

  it('refuses one entry at its range and keeps the others', () => {
    const text = INDEX.replace('    latest: v2.0.0\n', '    latest: --upload-pack=x\n');
    const read = parseGalleryIndex(text, 'index.yaml');
    expect(read.value?.entries.map((entry) => entry.id)).toEqual(['tabela', 'inbox']);
    expect(read.diagnostics).toHaveLength(1);
    const [problem] = read.diagnostics;
    expect(problem?.code).toBe('E_GALLERY_INDEX_ENTRY');
    expect(problem?.message).toContain('latest: it may not start with -');
    const start = problem?.range?.start ?? -1;
    expect(text.slice(start, start + 15)).toBe('--upload-pack=x');
  });

  it('refuses a template entry that names no template, and a duplicate id', () => {
    const text = `version: 1
entries:
  - { id: a, kind: template, name: A, description: d, source: { git: g }, latest: v1, engine: '*' }
  - { id: b, kind: plugin, name: B, description: d, source: { git: g }, latest: v1, engine: '*' }
  - { id: b, kind: plugin, name: B, description: d, source: { git: g }, latest: v1, engine: '*' }
`;
    const read = parseGalleryIndex(text, 'index.yaml');
    expect(read.value?.entries.map((entry) => entry.id)).toEqual(['b']);
    expect(read.diagnostics.map((item) => item.message)).toEqual([
      "Gallery index 'index.yaml': entry a was refused: templates: a template entry names the templates its manifest declares.",
      "Gallery index 'index.yaml': entry b was refused: an earlier entry has this id.",
    ]);
  });

  it('warns on an unknown key and lists the entry anyway', () => {
    const read = parseGalleryIndex(
      INDEX.replace(
        "    engine: '>=0.1.0'\n    changes",
        "    engine: '>=0.1.0'\n    stars: 5\n    changes",
      ),
      'index.yaml',
    );
    expect(read.value?.entries).toHaveLength(3);
    expect(read.diagnostics.map((item) => item.code)).toEqual(['W_GALLERY_INDEX_KEY_UNKNOWN']);
    expect(read.diagnostics[0]?.message).toContain('tabela.stars');
  });

  it('lists nothing from an index of another version or not YAML', () => {
    expect(parseGalleryIndex('version: 2\nentries: []\n', 'i').diagnostics[0]?.code).toBe(
      'E_GALLERY_INDEX_SYNTAX',
    );
    expect(parseGalleryIndex('version: 1\nentries: [\n', 'i').value).toBeUndefined();
  });
});

describe('galleryStatus', () => {
  /** A machine plugin file as a person keeps it: entries written by hand, some at older tags. */
  const FILE = `version: 1
templates:
  tabela:
    source:
      git: https://git.example.com/tyto-template-tabela # written without .git
      ref: v1.0.0
  agenda:
    source:
      git: https://git.example.com/tyto-template-agenda.git
      ref: v2.0.0
`;

  function folder() {
    const read = parsePluginFile(FILE, 'templates.yaml');
    if (read.value === undefined) throw new Error('the plugin file did not read');
    return {
      files: [read.value],
      lock: {
        sources: [
          {
            git: 'https://git.example.com/tyto-template-agenda.git',
            ref: 'v2.0.0',
            commit: 'a'.repeat(40),
            plugin: 'agenda',
          },
        ],
      },
    };
  }

  it('shows installed, update available and not installed, measured against the file and lock', () => {
    const statuses = galleryStatus(index(), folder(), '1.0.0');
    expect(
      statuses.map(({ entry, state, placements }) => ({
        id: entry.id,
        state,
        placements: placements.map(({ file, template, ref, synced }) => ({
          file,
          template,
          ref,
          synced,
        })),
      })),
    ).toEqual([
      {
        id: 'tabela',
        state: 'update available',
        placements: [{ file: 'templates.yaml', template: 'tabela', ref: 'v1.0.0', synced: false }],
      },
      {
        id: 'agenda',
        state: 'installed',
        placements: [{ file: 'templates.yaml', template: 'agenda', ref: 'v2.0.0', synced: true }],
      },
      { id: 'inbox', state: 'not installed', placements: [] },
    ]);
  });

  it('does not count a template of the same name from another repository', () => {
    const other = FILE.replace('tyto-template-agenda.git', 'a-fork-of-agenda.git');
    const read = parsePluginFile(other, 'templates.yaml');
    const statuses = galleryStatus(
      index(),
      { files: read.value === undefined ? [] : [read.value], lock: EMPTY_PLUGIN_FILES_LOCK },
      '1.0.0',
    );
    expect(statuses[1]?.state).toBe('not installed');
  });

  it('marks an entry that needs a newer plugin API as incompatible, and still lists it', () => {
    const statuses = galleryStatus(
      index(
        INDEX.replace(
          "latest: v0.3.0\n    engine: '>=0.1.0'",
          "latest: v0.3.0\n    engine: '>=99.0.0'",
        ),
      ),
      folder(),
      '1.0.0',
    );
    expect(statuses.map((status) => status.compatible)).toEqual([true, true, false]);
  });
});

describe('sameRepository', () => {
  it('ignores a trailing slash or .git, and nothing else', () => {
    expect(sameRepository('https://h/o/r.git', 'https://h/o/r/')).toBe(true);
    expect(sameRepository('https://h/o/r', 'https://h/o/r2')).toBe(false);
  });
});
