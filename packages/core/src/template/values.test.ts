import { describe, expect, it } from 'vitest';

import { TemplateError } from './errors.js';
import { color, font, lineBreak, linearGradient, run, solid, stop } from './values.js';

describe('color', () => {
  it('reads the four hex forms CSS accepts', () => {
    expect(color('#ff5900')).toEqual({ r: 255, g: 89, b: 0, a: 1 });
    expect(color('#F59')).toEqual({ r: 255, g: 85, b: 153, a: 1 });
    expect(color('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 0.502 });
    expect(color('#0008')).toEqual({ r: 0, g: 0, b: 0, a: 0.533 });
  });

  it('doubles each digit of a shorthand rather than padding it', () => {
    // `#f80` is `#ff8800`, not `#f08000`.
    expect(color('#f80')).toEqual(color('#ff8800'));
  });

  it('scales alpha into 0..1, because that is the unit the IR uses', () => {
    expect(color('#ffffffff').a).toBe(1);
    expect(color('#ffffff00').a).toBe(0);
  });

  it('fills alpha for channels that leave it out, and keeps one that does not', () => {
    expect(color({ r: 1, g: 2, b: 3 })).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(color({ r: 1, g: 2, b: 3, a: 0.25 })).toEqual({ r: 1, g: 2, b: 3, a: 0.25 });
  });

  it('throws a TemplateError carrying the diagnostic already built', () => {
    // A hex typo is a bug in code, not something a brief author can cause, so it throws
    // rather than travelling as a Result through every builder's return type.
    expect(() => color('#gggggg')).toThrow(TemplateError);

    try {
      color('rebeccapurple');
      throw new Error('expected color to reject a named colour');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(TemplateError);
      expect((thrown as TemplateError).diagnostic.code).toBe('E_TEMPLATE_VALUE');
      expect((thrown as TemplateError).diagnostic.message).toContain('rebeccapurple');
      expect((thrown as TemplateError).diagnostic.severity).toBe('error');
    }
  });

  it('rejects a hex of a length CSS does not define', () => {
    expect(() => color('#ff')).toThrow(TemplateError);
    expect(() => color('#fffff')).toThrow(TemplateError);
  });
});

describe('paints', () => {
  it('wraps a hex string into a solid paint', () => {
    expect(solid('#ffffff')).toEqual({
      kind: 'solid',
      color: { r: 255, g: 255, b: 255, a: 1 },
    });
  });

  it('builds a gradient whose stops are already colours', () => {
    expect(linearGradient(45, [stop(0, '#ff5900'), stop(1, '#ffbd00')])).toEqual({
      kind: 'linear-gradient',
      angle: 45,
      stops: [
        { offset: 0, color: { r: 255, g: 89, b: 0, a: 1 } },
        { offset: 1, color: { r: 255, g: 189, b: 0, a: 1 } },
      ],
    });
  });
});

describe('font', () => {
  it('is bundled by default and file-backed when given a path', () => {
    expect(font('Inter')).toEqual({ family: 'Inter', source: 'bundled' });
    expect(font('Recife', 'fonts/recife.woff2')).toEqual({
      family: 'Recife',
      source: 'file',
      path: 'fonts/recife.woff2',
    });
  });
});

describe('run', () => {
  const inter = font('Inter');

  it('defaults to regular upright text, since that is what body copy is', () => {
    expect(run('Turma nova', { font: inter, size: 96, color: '#ffffff' })).toEqual({
      kind: 'text',
      text: 'Turma nova',
      font: inter,
      size: 96,
      weight: 400,
      style: 'normal',
      color: { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } },
    });
  });

  it('omits decoration entirely rather than setting it to undefined', () => {
    // A strictObject rejects an undefined value where it accepts an absent key.
    expect('decoration' in run('x', { font: inter, size: 12, color: '#000' })).toBe(false);
  });

  it('lets a paint through untouched, so a run can carry a gradient', () => {
    const gradient = linearGradient(90, [stop(0, '#000'), stop(1, '#fff')]);

    expect(run('x', { font: inter, size: 12, color: gradient }).color).toBe(gradient);
  });
});

describe('lineBreak', () => {
  it('is a run with nothing on it, because a break has no glyph (ADR 0016)', () => {
    expect(lineBreak()).toEqual({ kind: 'break' });
  });
});
