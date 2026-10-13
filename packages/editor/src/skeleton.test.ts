// @vitest-environment jsdom
import { hasNextSnippetField, nextSnippetField } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { afterEach, describe, expect, it } from 'vitest';

import { briefSkeleton, insertBriefSkeleton, skeletonText } from './skeleton.js';

const manifestOf = (yaml: string): TemplateManifest => {
  const parsed = parseManifest(yaml, 'manifest.yaml');
  if (!parsed.ok) throw new Error('fixture manifest does not parse');
  return parsed.value;
};

/** The agenda's manifest as the built-in pack declares it, comments left out. */
const AGENDA = manifestOf(`
name: agenda-semana
version: 4.2.0
formats: [grid]
slots:
  titulo: { type: rich-text, required: true, max: 40 }
  imagem: { type: image }
  selo: { type: image }
  lamina: { type: rich-text, repeat: true, min: 1, max: 12 }
`);

/** Every kind of slot a skeleton writes, and two it leaves out. */
const EVERY_KIND = manifestOf(`
name: tudo
version: 1.0.0
formats: [grid, story]
slots:
  tom: { type: enum, required: true, values: [claro, escuro], default: escuro }
  cor: { type: enum, required: true, values: [azul, verde] }
  foto: { type: image, required: true }
  titulo: { type: rich-text, required: true, max: 3 }
  subtitulo: { type: rich-text }
  lamina: { type: rich-text, repeat: true, min: 3 }
`);

/** The field numbers a snippet template uses, in the order they are written. */
const fieldNumbers = (template: string): number[] =>
  [...template.matchAll(/[#$]\{(\d+)/gu)].map((match) => Number(match[1]));

describe('briefSkeleton', () => {
  it('writes the agenda as a brief with its title inline and one lamina block', () => {
    expect(briefSkeleton(AGENDA)).toBe(
      [
        '---',
        'template: agenda-semana',
        'formats: [grid]',
        '---',
        '',
        '::titulo ${1:titulo}',
        '',
        '::lamina',
        '\t${2:lamina}',
        '',
        '${0}',
      ].join('\n'),
    );
  });

  it('puts enums and images in the frontmatter, rich text in directives, and leaves optional slots out', () => {
    expect(skeletonText(briefSkeleton(EVERY_KIND))).toBe(
      [
        '---',
        'template: tudo',
        'formats: [grid, story]',
        'tom: escuro',
        'cor: azul',
        'foto: ./foto.png',
        '---',
        '',
        '::titulo tit',
        '',
        '::lamina',
        '\tlamina',
        '',
        '::lamina',
        '\tlamina',
        '',
        '::lamina',
        '\tlamina',
        '',
        '',
      ].join('\n'),
    );
  });

  it('numbers every field once, in the order they are written, with 0 last', () => {
    const numbers = fieldNumbers(briefSkeleton(EVERY_KIND));

    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
  });

  it('takes a repeated slot whose minimum is one, even when it is not required', () => {
    const withMinimum = (min: number): string =>
      briefSkeleton(
        manifestOf(`
name: lista
version: 1.0.0
formats: [grid]
slots:
  lamina: { type: rich-text, repeat: true, min: ${String(min)} }
`),
      );

    expect(withMinimum(1)).toContain('::lamina');
    expect(withMinimum(0)).not.toContain('::lamina');
  });

  it('writes a repeated slot that is required and has no minimum once', () => {
    const skeleton = briefSkeleton(
      manifestOf(`
name: lista
version: 1.0.0
formats: [grid]
slots:
  lamina: { type: rich-text, required: true, repeat: true }
`),
    );

    expect(skeleton.match(/::lamina/gu)).toHaveLength(1);
  });

  it('escapes braces, which would otherwise start a field', () => {
    const manifest = manifestOf(`
name: "a{b}"
version: 1.0.0
formats: ["x{y}"]
slots:
  tom: { type: enum, required: true, values: ["c{d}", e] }
`);

    const template = briefSkeleton(manifest);

    expect(skeletonText(template)).toContain('template: a{b}');
    expect(skeletonText(template)).toContain('formats: [x{y}]');
    expect(skeletonText(template)).toContain('tom: c{d}');
    expect(fieldNumbers(template)).toEqual([1, 0]);
  });
});

describe('insertBriefSkeleton', () => {
  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    view = undefined;
    document.body.replaceChildren();
  });

  const mount = (doc: string): EditorView => {
    const parent = document.createElement('div');
    document.body.append(parent);
    return new EditorView({ state: EditorState.create({ doc }), parent });
  };

  const selected = (editor: EditorView): string => {
    const { from, to } = editor.state.selection.main;
    return editor.state.sliceDoc(from, to);
  };

  it('replaces the document and walks the fields in order with Tab', () => {
    view = mount('anything');

    insertBriefSkeleton(view, EVERY_KIND);

    expect(view.state.doc.toString()).toBe(
      skeletonText(briefSkeleton(EVERY_KIND)).replace(/\t/gu, '  '),
    );

    const walked = [selected(view)];
    while (hasNextSnippetField(view.state)) {
      nextSnippetField(view);
      walked.push(selected(view));
    }

    expect(walked).toEqual([
      'escuro',
      'azul',
      './foto.png',
      'tit',
      'lamina',
      'lamina',
      'lamina',
      '',
    ]);
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  });

  it('keeps what was typed into a field and moves on to the next', () => {
    view = mount('');
    insertBriefSkeleton(view, AGENDA);

    view.dispatch(view.state.replaceSelection('AGENDA DA SEMANA'));
    nextSnippetField(view);
    view.dispatch(view.state.replaceSelection('FARMÁCIA'));

    expect(view.state.doc.toString()).toContain(
      '::titulo AGENDA DA SEMANA\n\n::lamina\n  FARMÁCIA\n',
    );
  });
});
