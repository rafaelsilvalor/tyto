import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { recipeLanguage } from './recipe-language.js';

/**
 * The colours of a recipe (TYTO-377), read as the editor would paint them: through the
 * highlight tags the theme styles, by class name here so the test names what it means. The
 * lines are the recipe package's own fixtures, `packages/recipe/src/__fixtures__/*.recipe`, and
 * its tests' data references.
 */
const named = tagHighlighter([
  { tag: tags.comment, class: 'comment' },
  { tag: tags.definitionKeyword, class: 'keyword' },
  { tag: tags.labelName, class: 'name' },
  { tag: tags.propertyName, class: 'param' },
  { tag: tags.meta, class: 'description' },
  { tag: tags.function(tags.variableName), class: 'verb' },
  { tag: tags.attributeName, class: 'argument' },
  { tag: tags.attributeValue, class: 'value' },
  { tag: tags.string, class: 'string' },
  { tag: tags.special(tags.variableName), class: 'placeholder' },
  { tag: tags.url, class: 'data' },
  { tag: tags.separator, class: 'equals' },
]);

const spans = (source: string): [string, string][] => {
  const found: [string, string][] = [];
  highlightTree(recipeLanguage.parser.parse(source), named, (from, to, tag) => {
    found.push([source.slice(from, to), tag]);
  });
  return found;
};

describe('the recipe colours', () => {
  it('colours the comment, the header, the description and a param line', () => {
    const source = [
      '# An invented campaign of a demo project, for derive, join and run.',
      'recipe campaign-map',
      '  | One row per design task of the demo campaign, its copy and its media paired.',
      'param team = design',
      'param kind = "anuncio"',
      '',
    ].join('\n');

    expect(spans(source)).toEqual([
      ['# An invented campaign of a demo project, for derive, join and run.', 'comment'],
      ['recipe', 'keyword'],
      ['campaign-map', 'name'],
      [
        '| One row per design task of the demo campaign, its copy and its media paired.',
        'description',
      ],
      ['param', 'keyword'],
      ['team', 'param'],
      ['=', 'equals'],
      ['design', 'value'],
      ['param', 'keyword'],
      ['kind', 'param'],
      ['=', 'equals'],
      ['"anuncio"', 'string'],
    ]);
  });

  it('colours the verb, a placeholder, named arguments and a quoted value with a placeholder in it', () => {
    const source = [
      'where kind = {kind} AND status != done',
      'join copy left="team = {team}" right="team = copy" on=pair_key',
      '',
    ].join('\n');

    expect(spans(source)).toEqual([
      ['where', 'verb'],
      ['{kind}', 'placeholder'],
      ['join', 'verb'],
      ['left', 'argument'],
      ['=', 'equals'],
      ['"team = ', 'string'],
      ['{team}', 'placeholder'],
      ['"', 'string'],
      ['right', 'argument'],
      ['=', 'equals'],
      ['"team = copy"', 'string'],
      ['on', 'argument'],
      ['=', 'equals'],
      ['pair_key', 'value'],
    ]);
  });

  it('colours a namespaced verb as one verb, and a data reference', () => {
    const source = [
      'jira.pull project={project}',
      'rules into=kind,label using=@./vocabulary.json#/kinds',
      'test.kinds @./vocab.json#/a~1b/~0tilde',
      '',
    ].join('\n');

    expect(spans(source)).toEqual([
      ['jira.pull', 'verb'],
      ['project', 'argument'],
      ['=', 'equals'],
      ['{project}', 'placeholder'],
      ['rules', 'verb'],
      ['into', 'argument'],
      ['=', 'equals'],
      ['kind,label', 'value'],
      ['using', 'argument'],
      ['=', 'equals'],
      ['@./vocabulary.json#/kinds', 'data'],
      ['test.kinds', 'verb'],
      ['@./vocab.json#/a~1b/~0tilde', 'data'],
    ]);
  });

  it('leaves positional words and a bare = plain', () => {
    const source = ['select key, title, status', 'sort points desc', 'show table', ''].join('\n');

    expect(spans(source)).toEqual([
      ['select', 'verb'],
      ['sort', 'verb'],
      ['show', 'verb'],
    ]);
  });

  it('ends an unclosed quote at the end of its line, so the next line starts fresh', () => {
    const source = ['where title = "open', 'show table', ''].join('\n');

    expect(spans(source)).toEqual([
      ['where', 'verb'],
      ['"open', 'string'],
      ['show', 'verb'],
    ]);
  });
});
