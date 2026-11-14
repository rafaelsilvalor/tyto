import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { chainSegments } from '@tyto/recipe';

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
  { tag: tags.separator, class: 'separator' },
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
      ['=', 'separator'],
      ['design', 'value'],
      ['param', 'keyword'],
      ['kind', 'param'],
      ['=', 'separator'],
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
      ['=', 'separator'],
      ['"team = ', 'string'],
      ['{team}', 'placeholder'],
      ['"', 'string'],
      ['right', 'argument'],
      ['=', 'separator'],
      ['"team = copy"', 'string'],
      ['on', 'argument'],
      ['=', 'separator'],
      ['pair_key', 'value'],
    ]);
  });

  it('colours apply auto as a header line, not as a step (TYTO-378)', () => {
    const source = ['recipe sync', 'apply auto', 'example.mark done', ''].join('\n');

    expect(spans(source)).toEqual([
      ['recipe', 'keyword'],
      ['sync', 'name'],
      ['apply', 'keyword'],
      ['auto', 'value'],
      ['example.mark', 'verb'],
    ]);
  });

  it('colours every 5m as a header line, not as a step (TYTO-385)', () => {
    const source = ['recipe watch', 'every 5m', 'apply auto', 'example.mark done', ''].join('\n');

    expect(spans(source)).toEqual([
      ['recipe', 'keyword'],
      ['watch', 'name'],
      ['every', 'keyword'],
      ['5m', 'value'],
      ['apply', 'keyword'],
      ['auto', 'value'],
      ['example.mark', 'verb'],
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
      ['=', 'separator'],
      ['{project}', 'placeholder'],
      ['rules', 'verb'],
      ['into', 'argument'],
      ['=', 'separator'],
      ['kind,label', 'value'],
      ['using', 'argument'],
      ['=', 'separator'],
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

/** The verbs a source's highlighting marks, in order. */
const verbs = (source: string): string[] =>
  spans(source)
    .filter(([, tag]) => tag === 'verb')
    .map(([text]) => text);

describe('a | that chains steps on one line (TYTO-712)', () => {
  it('colours the first word of every step of a chained line as a verb', () => {
    expect(spans('rows sheet | where x=1 | count rows\n')).toEqual([
      ['rows', 'verb'],
      ['|', 'separator'],
      ['where', 'verb'],
      ['x', 'argument'],
      ['=', 'separator'],
      ['1', 'value'],
      ['|', 'separator'],
      ['count', 'verb'],
    ]);
  });

  it('colours a namespaced verb after a | as one verb', () => {
    expect(verbs('where a = 1 | jira.push status=done\n')).toEqual(['where', 'jira.push']);
  });

  it("marks no verb inside a description, a quoted |, a pattern's a|b or a template's {x|upper}", () => {
    const source = [
      'recipe r',
      '  | Pull the rows | then count them',
      'where title matches "copy | web"',
      'extract title pattern=^(poster|flyer)$',
      'extract title pattern=a|b',
      'compose tag={team | upper}',
      'compose tag="{team | upper}"',
      'compose "Última Sync"={due|slug}',
      'where a = 1 |sort due',
      '',
    ].join('\n');

    expect(verbs(source)).toEqual([
      'where',
      'extract',
      'extract',
      'compose',
      'compose',
      'compose',
      'where',
    ]);
    expect(spans(source).filter(([text]) => text === '|')).toEqual([]);
  });

  it('marks a verb after each | the parser splits on, and after no other', () => {
    // The parser's own cases (TYTO-706's chain.test.ts), read by both: the colours follow the
    // same rule because they ask the same function, and this fails if that ever stops.
    const lines = [
      'where a = 1 | sort due | show table',
      'extract title pattern=^(poster|flyer)$',
      'where a = 1 |sort due',
      'where a = 1| sort due',
      'where title matches "copy | web"',
      'compose "Última Sync"={due|slug}',
      'compose tag={team | upper} | show table',
      'compose tag="{team | upper}" | show table',
    ];
    for (const line of lines) {
      const firstWords = chainSegments(line).map(
        (segment) => /^[\w.-]+/u.exec(line.slice(segment.from, segment.to))?.[0],
      );
      expect(verbs(`${line}\n`), line).toEqual(firstWords);
    }
  });

  it('chains nothing on a header line', () => {
    expect(verbs('recipe a | b\nparam p = x | y\n')).toEqual([]);
  });
});
