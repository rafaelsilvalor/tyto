import { highlightTree, tagHighlighter, tags } from '@lezer/highlight';
import { describe, expect, it } from 'vitest';

import { markdownLanguage } from './markdown-language.js';

/** The colours of a `.md` tab (TYTO-247), by the highlight tags the theme styles. */
const named = tagHighlighter([
  { tag: tags.heading, class: 'heading' },
  { tag: tags.emphasis, class: 'emphasis' },
  { tag: tags.strong, class: 'strong' },
  { tag: tags.link, class: 'link' },
  { tag: tags.url, class: 'url' },
  { tag: tags.monospace, class: 'monospace' },
  { tag: tags.quote, class: 'quote' },
  { tag: tags.strikethrough, class: 'strikethrough' },
]);

const spans = (source: string): [string, string][] => {
  const found: [string, string][] = [];
  highlightTree(markdownLanguage.parser.parse(source), named, (from, to, tag) => {
    found.push([source.slice(from, to), tag]);
  });
  return found;
};

describe('the Markdown colours', () => {
  it('tags a heading, emphasis, strong, a link, code, a quote and strikethrough', () => {
    const found = spans(
      ['# Title', '', '*a* **b** [c](http://d) `e`', '', '> f', '', '~~g~~'].join('\n'),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        ['# Title', 'heading'],
        ['*a*', 'emphasis'],
        ['**b**', 'strong'],
        ['[c](', 'link'],
        ['http://d', 'link url'],
        ['e', 'monospace'],
        ['> f', 'quote'],
        ['~~g~~', 'strikethrough'],
      ]),
    );
  });
});
