import type { RichText } from '@tyto/core';
import { describe, expect, it } from 'vitest';

import { parseBrief } from './parse-brief.js';
import { writeBrief } from './write-brief.js';

/** A body as plain text, a break as a line break, so a parse-back compares with the value. */
function plain(body: RichText): string {
  return body
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
          return inline.value;
        case 'break':
          return '\n';
        case 'bold':
          return `**${plain(inline.children)}**`;
        case 'italic':
          return `*${plain(inline.children)}*`;
        case 'mark':
          return plain(inline.children);
      }
    })
    .join('');
}

function written(text: string): {
  template: unknown;
  slots: Record<string, string>;
  errors: string[];
} {
  const parsed = parseBrief(text);
  if (!parsed.ok) throw new Error(parsed.error.map((item) => item.message).join('; '));
  return {
    template: parsed.value.frontmatter.data.template,
    slots: Object.fromEntries(
      parsed.value.directives.map((directive) => [directive.name, plain(directive.body)]),
    ),
    errors: parsed.diagnostics
      .filter((item) => item.severity === 'error')
      .map((item) => item.message),
  };
}

function textOf(result: ReturnType<typeof writeBrief>): string {
  if (!result.ok) throw new Error(result.error.map((item) => item.problem).join('; '));
  return result.value;
}

describe('writeBrief', () => {
  it('writes a brief that parses back to the same template and values', () => {
    const text = textOf(
      writeBrief({
        template: 'notice',
        slots: [
          { name: 'titulo', value: 'Direito **Constitucional**' },
          { name: 'subtitulo', value: 'Aulas ao vivo: toda semana' },
        ],
      }),
    );
    expect(text).toBe(
      '---\ntemplate: notice\n---\n' +
        '::titulo Direito **Constitucional**\n' +
        '::subtitulo Aulas ao vivo: toda semana\n',
    );
    expect(written(text)).toEqual({
      template: 'notice',
      slots: { titulo: 'Direito **Constitucional**', subtitulo: 'Aulas ao vivo: toda semana' },
      errors: [],
    });
  });

  it('writes a value of several lines as an indented block, blank lines dropped', () => {
    const text = textOf(
      writeBrief({ template: 'notice', slots: [{ name: 'lamina', value: 'Um\r\n\r\n  Dois  ' }] }),
    );
    expect(text).toContain('::lamina\n  Um\n  Dois\n');
    expect(written(text).slots).toEqual({ lamina: 'Um\nDois' });
  });

  it('escapes a line starting with :: and nothing else', () => {
    const text = textOf(
      writeBrief({
        template: 'notice',
        slots: [{ name: 'titulo', value: '::lamina is text\n::outra a::b' }],
      }),
    );
    expect(text).toContain('  \\::lamina is text\n  \\::outra a::b\n');
    const back = written(text);
    expect(back.slots).toEqual({ titulo: '::lamina is text\n::outra a::b' });
    expect(back.errors).toEqual([]);
  });

  it('refuses a brace, naming the slot, rather than changing the data', () => {
    const result = writeBrief({
      template: 'notice',
      slots: [
        { name: 'titulo', value: 'ok' },
        { name: 'subtitulo', value: 'a {cor:x} b' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      { slot: 'subtitulo', problem: "holds '{', which brief text cannot hold outside a mark" },
    ]);
  });

  it('names the slot whose value the grammar cannot hold', () => {
    const result = writeBrief({
      template: 'notice',
      slots: [
        { name: 'titulo', value: 'fine' },
        { name: 'subtitulo', value: '**open bold' },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.map((problem) => problem.slot)).toContain('subtitulo');
    expect(result.error.map((problem) => problem.slot)).not.toContain('titulo');
  });

  it('writes no directive for an empty value, so the template keeps its default', () => {
    const text = textOf(
      writeBrief({ template: 'notice', slots: [{ name: 'titulo', value: '  \n ' }] }),
    );
    expect(text).toBe('---\ntemplate: notice\n---\n');
  });

  it('quotes a template name YAML would read as something else', () => {
    const text = textOf(writeBrief({ template: 'yes: no', slots: [] }));
    expect(written(text).template).toBe('yes: no');
  });

  it('refuses a slot name that is not one', () => {
    const result = writeBrief({ template: 'notice', slots: [{ name: '::x', value: 'a' }] });
    expect(result.ok).toBe(false);
  });
});
