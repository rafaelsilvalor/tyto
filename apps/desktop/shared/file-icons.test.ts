import { describe, expect, it } from 'vitest';

import {
  type FileIconName,
  type FileIconSubject,
  documentFormatOf,
  fileIconFor,
  isTextFile,
} from './file-icons.js';

const file = (name: string): FileIconSubject => ({ name, kind: 'file' });

describe('fileIconFor', () => {
  it.each<[string, FileIconName]>([
    ['template.html', 'templateHtml'],
    ['Template.TS', 'templateTs'],
    ['manifest.yaml', 'manifest'],
    ['manifest.yml', 'manifest'],
    ['logo.png', 'image'],
    ['foto.JPG', 'image'],
    ['foto.jpeg', 'image'],
    ['selo.svg', 'image'],
    ['capa.webp', 'image'],
    ['anim.gif', 'image'],
    ['CircularXX-Bold.otf', 'font'],
    ['Inter.ttf', 'font'],
    ['Inter.woff', 'font'],
    ['Inter.woff2', 'font'],
    ['settings.json', 'settingsFile'],
    ['keybindings.json', 'keybindingsFile'],
    ['snippets.json', 'snippetsFile'],
    ['dados.json', 'json'],
    ['dados.jsonc', 'json'],
    ['LEIA-ME.md', 'text'],
    ['notas.txt', 'text'],
  ])('names %s by its name', (name, expected) => {
    expect(fileIconFor(file(name))).toBe(expected);
  });

  it('gives anything it does not know the fallback', () => {
    expect(fileIconFor(file('planilha.xlsx'))).toBe('file');
    expect(fileIconFor(file('Makefile'))).toBe('file');
    // A leading dot is a name, not an extension.
    expect(fileIconFor(file('.json'))).toBe('file');
  });

  it('draws a brief by its kind, which main decided', () => {
    expect(fileIconFor({ name: 'agenda.brief', kind: 'brief' })).toBe('brief');
  });

  it('turns a plain folder open and closed', () => {
    expect(fileIconFor({ name: 'editaveis', kind: 'folder' })).toBe('folder');
    expect(fileIconFor({ name: 'editaveis', kind: 'folder', expanded: true })).toBe('folderOpen');
  });

  it('knows an assets folder by its name, open or closed', () => {
    expect(fileIconFor({ name: 'assets', kind: 'folder' })).toBe('folderAssets');
    expect(fileIconFor({ name: 'Assets', kind: 'folder', expanded: true })).toBe('folderAssets');
  });

  it('never knows the output folder or a template folder by name alone', () => {
    expect(fileIconFor({ name: 'saida', kind: 'folder' })).toBe('folder');
    expect(fileIconFor({ name: 'output', kind: 'folder' })).toBe('folder');
    expect(fileIconFor({ name: 'templates', kind: 'folder' })).toBe('folder');
    expect(fileIconFor(file('project.json'))).toBe('json');
  });

  it("takes main's place over the name", () => {
    expect(fileIconFor({ name: 'saida', kind: 'folder', place: 'output' })).toBe('folderOutput');
    expect(fileIconFor({ name: 'assets', kind: 'folder', place: 'output' })).toBe('folderOutput');
    expect(fileIconFor({ name: 'modelos', kind: 'folder', place: 'templates' })).toBe(
      'templateFolder',
    );
    expect(fileIconFor({ name: 'banner', kind: 'folder', place: 'template', expanded: true })).toBe(
      'templateFolder',
    );
    expect(fileIconFor({ name: 'fotos', kind: 'folder', place: 'assets' })).toBe('folderAssets');
    expect(fileIconFor({ name: 'project.json', kind: 'file', place: 'project' })).toBe(
      'projectFile',
    );
  });
});

/** TYTO-247, ADR 0132: only `.txt` and `.md` are text; everything else opens as it did. */
describe('what a file opens as', () => {
  it.each([
    ['notas.md', 'markdown', true],
    ['LEIA.MD', 'markdown', true],
    ['leia.txt', 'text', true],
    ['capa.brief', 'brief', false],
    ['dados.json', 'brief', false],
    ['tabela.csv', 'brief', false],
    ['manifest.yaml', 'brief', false],
    ['.md', 'brief', false],
    ['x.constructor', 'brief', false],
  ] as const)('%s opens as %s', (name, format, text) => {
    expect(documentFormatOf(name)).toBe(format);
    expect(isTextFile(name)).toBe(text);
  });
});
