import { describe, expect, it } from 'vitest';

import { planTemplateEdit, templateOf } from './frontmatter.js';

/**
 * The picker's one edit, checked by applying it.
 *
 * Every case asserts the resulting *document* rather than the offsets, because the offsets
 * are a means: what the card promises is that choosing a template leaves a brief that names
 * it and is otherwise the brief the author wrote. `apply` is what makes that readable.
 */

const apply = (brief: string, template: string): string => {
  const edit = planTemplateEdit(brief, template);
  if (edit === undefined) return brief;
  return brief.slice(0, edit.from) + edit.insert + brief.slice(edit.to);
};

describe('choosing a template rewrites one line', () => {
  it('replaces the value and leaves the rest of the frontmatter alone', () => {
    const brief = [
      '---',
      'template: cartaz',
      'formats: [feed]',
      'cor: laranja',
      '---',
      '::slide',
    ].join('\n');

    expect(apply(brief, 'promo-curso')).toBe(
      ['---', 'template: promo-curso', 'formats: [feed]', 'cor: laranja', '---', '::slide'].join(
        '\n',
      ),
    );
  });

  it('keeps the spacing the author wrote around the colon', () => {
    // The frontmatter is the author's YAML and is left alone (ADR 0004). Replacing the
    // value and not the line is what makes that true of the spacing too.
    expect(apply('---\ntemplate:cartaz\n---\n', 'promo')).toBe('---\ntemplate:promo\n---\n');
    expect(apply('---\ntemplate:   cartaz\n---\n', 'promo')).toBe('---\ntemplate:   promo\n---\n');
  });

  it('adds the key when the frontmatter has none', () => {
    expect(apply('---\nformats: [feed]\n---\n::slide\n', 'promo')).toBe(
      '---\ntemplate: promo\nformats: [feed]\n---\n::slide\n',
    );
  });

  it('writes a whole frontmatter when the brief has none', () => {
    expect(apply('::slide\n  Primeiro\n', 'promo')).toBe(
      '---\ntemplate: promo\n---\n::slide\n  Primeiro\n',
    );
  });

  it('writes no trailing blank line into an empty brief', () => {
    expect(apply('', 'promo')).toBe('---\ntemplate: promo\n---\n');
  });

  it('does nothing when the brief already names that template', () => {
    // Not an edit that happens to be a no-op: `undefined` is what keeps the picker from
    // pushing an entry onto the undo stack every time it is re-rendered.
    expect(planTemplateEdit('---\ntemplate: promo\n---\n', 'promo')).toBeUndefined();
  });

  it('uses the line ending the document already uses', () => {
    // A brief is a file a person edits and all three endings reach the parser
    // (`docs/brief-language.md`); introducing a second kind on a Windows file would be this
    // app deciding something about the author's disk.
    expect(apply('---\r\nformats: [feed]\r\n---\r\n', 'promo')).toBe(
      '---\r\ntemplate: promo\r\nformats: [feed]\r\n---\r\n',
    );
    expect(apply('::slide\r\n', 'promo')).toBe('---\r\ntemplate: promo\r\n---\r\n::slide\r\n');
  });

  it('ignores a --- that is not the first line', () => {
    // Without an opening fence on line one there is no frontmatter, so this brief gains a
    // whole one rather than having its prose edited.
    expect(apply('::slide\n---\ntemplate: nope\n---\n', 'promo')).toBe(
      '---\ntemplate: promo\n---\n::slide\n---\ntemplate: nope\n---\n',
    );
  });

  it('ignores an unterminated frontmatter, which is not one', () => {
    expect(apply('---\ntemplate: cartaz\n', 'promo')).toBe(
      '---\ntemplate: promo\n---\n---\ntemplate: cartaz\n',
    );
  });
});

describe('reading the template a brief names', () => {
  it('finds it, trimmed', () => {
    expect(templateOf('---\ntemplate:   cartaz  \n---\n')).toBe('cartaz');
  });

  it('answers nothing for a brief that names none', () => {
    expect(templateOf('::slide\n')).toBeUndefined();
    expect(templateOf('---\nformats: [feed]\n---\n')).toBeUndefined();
    expect(templateOf('---\ntemplate:\n---\n')).toBeUndefined();
  });

  it('does not read a key from outside the fences', () => {
    expect(templateOf('---\nformats: [feed]\n---\ntemplate: nope\n')).toBeUndefined();
  });
});
