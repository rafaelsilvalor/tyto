import { EditorSelection, EditorState } from '@codemirror/state';
import { parser } from '@tyto/brief-lang';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { briefAnalysisField, setBriefAnalysis } from './analysis.js';
import { briefBlocks } from './brief-blocks.js';
import { breadcrumbAt, breadcrumbOf, directiveLabel } from './breadcrumb.js';
import { briefLanguage } from './brief-language.js';
import { fullyParsed } from './test-parse.js';

const manifestOf = (yaml: string): TemplateManifest => {
  const parsed = parseManifest(yaml, 'manifest.yaml');
  if (!parsed.ok) throw new Error('fixture manifest does not parse');
  return parsed.value;
};

const AGENDA = manifestOf(`
name: agenda
version: 1.0.0
formats: [grid]
slots:
  titulo: { type: rich-text, required: true }
  lamina: { type: rich-text, repeat: true, min: 1, max: 10 }
`);

const BRIEF = [
  '---', //                         1  opening fence
  'template: agenda', //            2
  'formato: story', //              3
  '  - continued', //               4  not a key: the one above it stands
  '---', //                         5  closing fence
  '::titulo Agenda da **semana**', // 6
  '::lamina', //                    7
  '  FARMÁCIA', //                  8
  '', //                            9  between two text lines: inside
  '  16/09 - 14:00', //             10
  '', //                            11 after the last text line: outside
  '::lamina', //                    12
  '  NUTRIÇÃO', //                  13
  '// a comment', //                14
  '::ai/caption', //                15
  '  legenda', //                   16
].join('\n');

/** The offset of the start of `line` (from 1), plus `column`. */
const at = (line: number, column = 0): number =>
  BRIEF.split('\n')
    .slice(0, line - 1)
    .reduce((sum, text) => sum + text.length + 1, 0) + column;

/** `known` false reads the blocks with no manifest, as before the first analysis. */
const crumbAt = (pos: number, known = true) =>
  breadcrumbAt(
    briefBlocks(
      parser.parse(BRIEF),
      (from, to) => BRIEF.slice(from, to),
      known ? AGENDA : undefined,
    ),
    pos,
    (from, to) => BRIEF.slice(from, to),
  );

describe('directiveLabel', () => {
  it('numbers a repeat slot only, and keeps a namespace', () => {
    expect(directiveLabel({ name: 'lamina', ordinal: 2 })).toBe('::lamina 2');
    expect(directiveLabel({ name: 'titulo' })).toBe('::titulo');
    expect(directiveLabel({ name: 'ai/caption' })).toBe('::ai/caption');
  });
});

describe('breadcrumbAt', () => {
  it('names the directive the caret is in, with an ordinal only for a repeat slot', () => {
    expect(crumbAt(at(6, 3))).toEqual({ kind: 'directive', label: '::titulo' });
    expect(crumbAt(at(8, 4))).toEqual({ kind: 'directive', label: '::lamina 1' });
    expect(crumbAt(at(13, 4))).toEqual({ kind: 'directive', label: '::lamina 2' });
    expect(crumbAt(at(16))).toEqual({ kind: 'directive', label: '::ai/caption' });
  });

  it('numbers nothing while no manifest is known', () => {
    expect(crumbAt(at(13, 4), false)).toEqual({ kind: 'directive', label: '::lamina' });
  });

  it('keeps a blank line between two text lines inside its block', () => {
    expect(crumbAt(at(9))).toEqual({ kind: 'directive', label: '::lamina 1' });
  });

  it('is empty after a block’s last text line, between blocks and on a comment', () => {
    expect(crumbAt(at(11))).toBeUndefined();
    expect(crumbAt(at(14, 5))).toBeUndefined();
  });

  it('names the frontmatter key on or above the caret’s line', () => {
    expect(crumbAt(at(2, 3))).toEqual({ kind: 'frontmatter', key: 'template' });
    expect(crumbAt(at(3))).toEqual({ kind: 'frontmatter', key: 'formato' });
    expect(crumbAt(at(4, 4))).toEqual({ kind: 'frontmatter', key: 'formato' });
    expect(crumbAt(at(5, 2))).toEqual({ kind: 'frontmatter', key: 'formato' });
  });

  it('gives the frontmatter alone on its opening fence', () => {
    expect(crumbAt(at(1, 1))).toEqual({ kind: 'frontmatter' });
  });
});

describe('breadcrumbOf', () => {
  const stateAt = (pos: number): EditorState =>
    fullyParsed(
      EditorState.create({
        doc: BRIEF,
        selection: EditorSelection.cursor(pos),
        extensions: [briefLanguage, briefAnalysisField],
      }),
    ).update({
      effects: setBriefAnalysis.of({
        source: BRIEF,
        diagnostics: [],
        templates: [],
        manifest: AGENDA,
      }),
    }).state;

  it('reads the main selection’s head in an editor state', () => {
    expect(breadcrumbOf(stateAt(at(13, 2)))).toEqual({ kind: 'directive', label: '::lamina 2' });
    expect(breadcrumbOf(stateAt(at(2, 0)))).toEqual({ kind: 'frontmatter', key: 'template' });
    expect(breadcrumbOf(stateAt(at(11)))).toBeUndefined();
  });
});
