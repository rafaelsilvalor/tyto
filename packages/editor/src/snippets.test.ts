// @vitest-environment jsdom
import {
  CompletionContext,
  completionStatus,
  currentCompletions,
  nextSnippetField,
  selectedCompletion,
} from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { type TemplateManifest, parseManifest } from '@tyto/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { briefAnalysisField, setBriefAnalysis } from './analysis.js';
import { briefLanguage } from './brief-language.js';
import { slashCompletion } from './slash.js';
import {
  type BriefSnippet,
  briefSnippets,
  completeSnippets,
  snippetTemplate,
  snippetsSlashSource,
  tabThroughCompletions,
} from './snippets.js';

/**
 * The person's snippets (TYTO-277): VS Code's body syntax translated to CodeMirror's, and the
 * snippet offered, inserted and walked in a real `EditorView`.
 */

const AULA: BriefSnippet = {
  name: 'Aula',
  prefixes: ['aula'],
  template: snippetTemplate('::aula ${1:titulo}\n::prof ${2:nome}').template ?? '',
  description: 'Uma aula com professor',
};

const AUDIO: BriefSnippet = { name: 'Audio', prefixes: ['audio'], template: '::audio ${1}' };

const AGENDA_ONLY: BriefSnippet = {
  name: 'Dia',
  prefixes: ['dia'],
  template: '::dia ${1:data}',
  forTemplate: 'agenda-semana',
};

const manifestOf = (yaml: string): TemplateManifest => {
  const parsed = parseManifest(yaml, 'manifest.yaml');
  if (!parsed.ok) throw new Error('fixture manifest does not parse');
  return parsed.value;
};

const AGENDA = manifestOf(`
name: agenda-semana
version: 1.0.0
formats: [grid]
slots:
  titulo: { type: rich-text }
`);

describe('a VS Code body as a CodeMirror template', () => {
  it.each([
    ['$1 and $2', '${1} and ${2}'],
    ['${1} then $0', '${1} then ${0}'],
    ['${1:titulo}', '${1:titulo}'],
    ['::item {destaque} texto', '::item \\{destaque\\} texto'],
    ['#{nao} ${ x', '#\\{nao\\} $\\{ x'],
    ['R$ 50 and \\$1', 'R$ 50 and $1'],
    ['\\} and \\\\', '\\} and \\'],
    ['plain', 'plain'],
  ])('%s', (body, template) => {
    expect(snippetTemplate(body)).toEqual({ template, problems: [] });
  });

  it('inserts a choice as its first option and says the rest were dropped', () => {
    expect(snippetTemplate('tom ${1|claro,escuro|}')).toEqual({
      template: 'tom ${1:claro}',
      problems: [{ kind: 'choice-flattened', field: 1, first: 'claro' }],
    });
  });

  it.each([
    ['$TM_FILENAME', 'the variable $TM_FILENAME'],
    ['${CURRENT_YEAR}', 'the variable ${CURRENT_YEAR}'],
    ['${1/(.*)/$1/}', 'a transform in field 1'],
    ['${1:a ${2:b}}', 'a field inside field 1'],
    ['${1:a\\}b}', 'a brace inside field 1'],
    ['${1:a\nb}', 'a line break inside field 1'],
    ['${1:open', 'an unclosed field 1'],
  ])('refuses %s', (body, what) => {
    const translated = snippetTemplate(body);
    expect(translated.template).toBeUndefined();
    expect(translated.problems).toContainEqual({ kind: 'unsupported', what });
  });
});

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
});

function mount(doc: string, snippets: readonly BriefSnippet[]): EditorView {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        briefLanguage,
        briefAnalysisField,
        tabThroughCompletions(),
        briefSnippets(() => snippets),
      ],
    }),
  });
  return view;
}

function type(target: EditorView, text: string): void {
  for (const character of text) {
    const at = target.state.selection.main.head;
    target.dispatch({
      changes: { from: at, insert: character },
      selection: { anchor: at + 1 },
      userEvent: 'input.type',
    });
  }
}

function press(target: EditorView, key: string, shiftKey = false): boolean {
  return runScopeHandlers(target, new KeyboardEvent('keydown', { key, shiftKey }), 'editor');
}

const labels = (target: EditorView): string[] =>
  currentCompletions(target.state).map((option) => option.label);

async function waitForList(target: EditorView): Promise<void> {
  await vi.waitFor(() => {
    expect(completionStatus(target.state)).toBe('active');
    expect(currentCompletions(target.state).length).toBeGreaterThan(0);
  });
}

const selected = (target: EditorView): string =>
  target.state.sliceDoc(target.state.selection.main.from, target.state.selection.main.to);

const answers = (doc: string, at = doc.length): boolean => {
  const state = EditorState.create({ doc, extensions: [briefLanguage, briefAnalysisField] });
  return completeSnippets(() => [AULA])(new CompletionContext(state, at, false)) !== null;
};

describe('the snippets in completion', () => {
  it('offers "aula" on typing it, inserts it with "titulo" selected, and Tab walks to "nome"', async () => {
    const target = mount('', [AULA, AUDIO]);
    type(target, 'aula');
    await waitForList(target);
    expect(labels(target)).toEqual(['aula']);

    // Past CodeMirror's 75 ms in which Enter would not accept.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(press(target, 'Enter')).toBe(true);

    expect(target.state.doc.toString()).toBe('::aula titulo\n::prof nome');
    expect(selected(target)).toBe('titulo');
    expect(nextSnippetField(target)).toBe(true);
    expect(selected(target)).toBe('nome');
  });

  it('stays shut where a word does not start its line, and inside the frontmatter', () => {
    expect(answers('aula')).toBe(true);
    expect(answers('::titulo aula')).toBe(false);
    expect(answers('  aula')).toBe(false);
    expect(answers('/aula')).toBe(false);
    expect(answers('---\naula\n---\n', 8)).toBe(false);
  });

  it('offers a snippet limited to a template only while the brief names that template', () => {
    const contextFor = (manifest?: TemplateManifest): CompletionContext => {
      const created = EditorState.create({
        doc: 'di',
        extensions: [briefLanguage, briefAnalysisField],
      });
      const state = created.update({
        effects: setBriefAnalysis.of({
          source: 'di',
          diagnostics: [],
          templates: ['agenda-semana'],
          ...(manifest === undefined ? {} : { manifest }),
        }),
      }).state;
      return new CompletionContext(state, 2, false);
    };
    const source = completeSnippets(() => [AGENDA_ONLY]);
    expect(source(contextFor())).toBeNull();
    expect(source(contextFor(AGENDA))?.options.map((option) => option.label)).toEqual(['dia']);
  });

  it('moves through an open list with Tab and Shift+Tab, and lets Tab through with none', async () => {
    const target = mount('', [AULA, AUDIO]);
    type(target, 'au');
    await waitForList(target);
    expect(labels(target)).toEqual(['audio', 'aula']);
    expect(selectedCompletion(target.state)?.label).toBe('audio');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(press(target, 'Tab')).toBe(true);
    expect(selectedCompletion(target.state)?.label).toBe('aula');
    expect(press(target, 'Tab', true)).toBe(true);
    expect(selectedCompletion(target.state)?.label).toBe('audio');
    expect(target.state.doc.toString()).toBe('au');

    press(target, 'Escape');
    expect(currentCompletions(target.state)).toEqual([]);
    expect(press(target, 'Tab')).toBe(false);
  });
});

describe('the snippets in the "/" menu', () => {
  it('lists them under their own section and inserts one in place of the "/"', async () => {
    const parent = document.createElement('div');
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        extensions: [
          briefLanguage,
          briefAnalysisField,
          slashCompletion([
            snippetsSlashSource(
              () => 'Snippets',
              () => [AULA],
            ),
          ]),
        ],
      }),
    });
    type(view, '/');
    await waitForList(view);
    const option = currentCompletions(view.state)[0];
    expect(option?.label).toBe('aula');
    expect(option?.section).toEqual({ name: 'Snippets', rank: 0 });

    await new Promise((resolve) => setTimeout(resolve, 100));
    press(view, 'Enter');
    expect(view.state.doc.toString()).toBe('::aula titulo\n::prof nome');
    expect(selected(view)).toBe('titulo');
  });
});
