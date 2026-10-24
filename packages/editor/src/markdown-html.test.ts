import { describe, expect, it } from 'vitest';

import { MARKDOWN_TAGS, markdownToHtml } from './markdown-html.js';

/** Every tag name the output opens or closes: each `<` in it, so a test can hold it to the list. */
const tagsIn = (html: string): string[] =>
  [...html.matchAll(/<\/?([^\s>]*)/gu)].map((match) => (match[1] ?? '').toLowerCase());

/** Every attribute name the output writes. */
const attributesIn = (html: string): string[] =>
  [...html.matchAll(/<[a-z][a-z0-9]*((?:\s+[^\s>]+)*)\s*>/giu)].flatMap((match) =>
    (match[1] ?? '')
      .trim()
      .split(/\s+/u)
      .filter((part) => part !== '')
      .map((part) => (part.split('=')[0] ?? '').toLowerCase()),
  );

describe('markdownToHtml is sanitised by construction (TYTO-247)', () => {
  // Each source would run a script, load something or navigate if it reached the frame as markup.
  const hostile: readonly [string, string, string][] = [
    ['a script element', '<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    [
      'an image with an onerror handler',
      'text <img src=x onerror=alert(1)> more',
      'text &lt;img src=x onerror=alert(1)&gt; more',
    ],
    ['a javascript: link', '[x](javascript:alert(1))', '<a title="javascript:alert(1)">x</a>'],
    [
      'a raw HTML block',
      '<div onclick="alert(1)" style="color:red">\nhi\n</div>',
      '&lt;div onclick=&quot;alert(1)&quot; style=&quot;color:red&quot;&gt;',
    ],
    ['an iframe', '<iframe src="http://example.com"></iframe>', '&lt;iframe src='],
    [
      'an anchor with href written as raw HTML',
      'go <a href="http://example.com">here</a>',
      'go &lt;a href=&quot;http://example.com&quot;&gt;here&lt;/a&gt;',
    ],
    ['a comment', '<!-- <script>x</script> -->', '&lt;!-- &lt;script&gt;'],
    ['a processing instruction', '<?php echo 1; ?>', '&lt;?php echo 1; ?&gt;'],
    ['an image', '![a <b>cat</b>](http://example.com/cat.png)', 'a &lt;b&gt;cat&lt;/b&gt;'],
  ];

  it.each(hostile)('%s comes out escaped', (_name, source, expected) => {
    const html = markdownToHtml(source);
    expect(html).toContain(expected);
    expect(tagsIn(html).filter((tag) => !MARKDOWN_TAGS.has(tag))).toEqual([]);
    expect(attributesIn(html).filter((name) => name !== 'title')).toEqual([]);
  });

  it('writes a link as an <a> with no href, its destination in the title', () => {
    expect(markdownToHtml('see [the site](https://tyto.example/x "Title")')).toBe(
      '<p>see <a title="https://tyto.example/x">the site</a></p>',
    );
  });

  it('writes an image as its alt text only', () => {
    expect(markdownToHtml('![a *cat*](cat.png)')).toBe('<p>a cat</p>');
  });

  it('escapes a title that would close the attribute', () => {
    expect(markdownToHtml('[x](<a" onmouseover="b>)')).not.toMatch(/"\s+onmouseover=/u);
  });
});

describe('markdownToHtml draws CommonMark', () => {
  it('writes headings, emphasis, code and a quote', () => {
    const source = [
      '# Title',
      '',
      'Some *soft* and **loud** text with `code`.',
      '',
      '> quoted',
      '',
      '```ts',
      'const a = 1 < 2;',
      '```',
      '',
      '---',
      '',
      '1. one',
      '2. two',
    ].join('\n');
    expect(markdownToHtml(source)).toBe(
      '<h1>Title</h1>' +
        '<p>Some <em>soft</em> and <strong>loud</strong> text with <code>code</code>.</p>' +
        '<blockquote><p>quoted</p></blockquote>' +
        '<pre><code>const a = 1 &lt; 2;</code></pre>' +
        '<hr>' +
        '<ol><li><p>one</p></li><li><p>two</p></li></ol>',
    );
  });

  it('keeps an entity the source wrote, and a backslash escape as its character', () => {
    expect(markdownToHtml('&copy; \\*not em\\*')).toBe('<p>&copy; *not em*</p>');
  });
});

describe('markdownToHtml draws GitHub’s extensions', () => {
  it('writes a table with a header row', () => {
    const source = ['| Name | Price |', '| --- | --- |', '| Tea | 2 |', '| Cake | 5 |'].join('\n');
    expect(markdownToHtml(source)).toBe(
      '<table><thead><tr><th>Name</th><th>Price</th></tr></thead>' +
        '<tbody><tr><td>Tea</td><td>2</td></tr><tr><td>Cake</td><td>5</td></tr></tbody></table>',
    );
  });

  it('writes a task list as checkboxes that cannot be ticked', () => {
    expect(markdownToHtml('- [x] done\n- [ ] to do')).toBe(
      '<ul><li><input type="checkbox" disabled checked>done</li>' +
        '<li><input type="checkbox" disabled>to do</li></ul>',
    );
  });

  it('writes strikethrough as <del>', () => {
    expect(markdownToHtml('~~gone~~ here')).toBe('<p><del>gone</del> here</p>');
  });

  it('writes a bare address as a link with no href', () => {
    expect(markdownToHtml('visit https://tyto.example now')).toBe(
      '<p>visit <a title="https://tyto.example">https://tyto.example</a> now</p>',
    );
  });
});
