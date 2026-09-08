import type { Color, Diagnostic, GradientStop, Paint, Size, SourceRange, Stroke } from '@tyto/core';
import {
  TemplateError,
  color,
  linearGradient,
  radialGradient,
  solid,
  stop,
} from '@tyto/core/template';

import type { ValueToken } from './ast.js';
import { badValue } from './vocabulary.js';

/**
 * Declaration values → the leaf types of the IR.
 *
 * A value is a flat list of tokens by the time it gets here, because what `700 72px/1.05
 * "Inter"` means is a question only the `font` property can answer. Each reader below is
 * one property's answer, and every one of them reports through the same channel rather
 * than throwing: a stylesheet with four bad values should show an author four underlines,
 * not the first one four times.
 *
 * The colours are the exception the SDK named. `color()` in `@tyto/core/template` refuses
 * a name because "white is the stylesheet's word, not a value's" — and this *is* the
 * stylesheet, so the word is resolved here and a channel triple is what leaves.
 */

export type Report = (item: Diagnostic) => void;

/** What `%`, `vw` and `vh` are relative to. */
export interface LengthContext {
  /** The box a percentage is of: the frame, or the nearest group that declared a size. */
  readonly parent: Size;
  /** The frame, which is what `vw` and `vh` are of, whatever the nesting. */
  readonly frame: Size;
}

/** Which dimension a percentage of the parent means. */
export type Axis = 'w' | 'h';

/**
 * The words a stylesheet may use for a colour.
 *
 * The CSS basic set and nothing more. A longer list would be a second, worse palette: a
 * template's own vocabulary belongs in `:root` as `--brand`, where the name means what
 * this template says it means.
 */
const NAMED_COLORS: Readonly<Record<string, string>> = {
  transparent: '#00000000',
  black: '#000000',
  silver: '#c0c0c0',
  gray: '#808080',
  grey: '#808080',
  white: '#ffffff',
  maroon: '#800000',
  red: '#ff0000',
  purple: '#800080',
  fuchsia: '#ff00ff',
  green: '#008000',
  lime: '#00ff00',
  olive: '#808000',
  yellow: '#ffff00',
  navy: '#000080',
  blue: '#0000ff',
  teal: '#008080',
  aqua: '#00ffff',
};

function describe(tokens: readonly ValueToken[]): string {
  return tokens
    .map((token) => {
      switch (token.kind) {
        case 'slash':
          return '/';
        case 'comma':
          return ',';
        case 'call':
          return `${token.name}(…)`;
        case 'string':
          return `"${token.text}"`;
        default:
          return token.text;
      }
    })
    .join(' ');
}

function spanOf(tokens: readonly ValueToken[], fallback: SourceRange): SourceRange {
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (first === undefined || last === undefined) return fallback;
  return { start: first.range.start, end: last.range.end };
}

/** Everything up to the next top-level comma, and the rest after it. */
function splitOnCommas(tokens: readonly ValueToken[]): ValueToken[][] {
  const groups: ValueToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind === 'comma') {
      groups.push([]);
      continue;
    }
    groups[groups.length - 1]?.push(token);
  }
  return groups;
}

export function readColor(
  tokens: readonly ValueToken[],
  field: string,
  at: SourceRange,
  report: Report,
): Color | undefined {
  const only = tokens.length === 1 ? tokens[0] : undefined;

  if (only?.kind === 'ident') {
    const named = NAMED_COLORS[only.text.toLowerCase()];
    if (named === undefined) {
      report(
        badValue(
          field,
          `'${only.text}' is not a colour; write a hex value such as '#ff5900' or one of ${Object.keys(NAMED_COLORS).join(', ')}`,
          only.range,
        ),
      );
      return undefined;
    }
    return color(named);
  }

  if (only?.kind === 'hex') {
    try {
      return color(only.text);
    } catch (cause) {
      report(
        badValue(
          field,
          cause instanceof TemplateError ? `'${only.text}' is not a hex colour` : String(cause),
          only.range,
        ),
      );
      return undefined;
    }
  }

  report(badValue(field, `'${describe(tokens)}' is not a colour`, spanOf(tokens, at)));
  return undefined;
}

/** `0`, `0.5` and `50%` all mean the same offset; a gradient reads both spellings. */
function readOffset(
  token: ValueToken | undefined,
  field: string,
  at: SourceRange,
  report: Report,
): number | undefined {
  if (token?.kind !== 'dimension' || (token.unit !== '' && token.unit !== '%')) {
    report(badValue(field, 'a gradient stop needs an offset, as in #fff 0.5 or #fff 50%', at));
    return undefined;
  }
  const offset = token.unit === '%' ? token.number / 100 : token.number;
  if (offset < 0 || offset > 1) {
    report(badValue(field, `a gradient stop sits between 0 and 1, not at ${offset}`, token.range));
    return undefined;
  }
  return offset;
}

function readStops(
  groups: readonly ValueToken[][],
  field: string,
  at: SourceRange,
  report: Report,
): GradientStop[] | undefined {
  const stops: GradientStop[] = [];

  for (const group of groups) {
    const offset = readOffset(group[group.length - 1], field, at, report);
    const paint = readColor(group.slice(0, -1), field, at, report);
    if (offset === undefined || paint === undefined) return undefined;
    stops.push(stop(offset, paint));
  }

  if (stops.length < 2) {
    report(badValue(field, 'a gradient needs at least two stops', at));
    return undefined;
  }
  return stops;
}

function readAngle(
  tokens: readonly ValueToken[],
  field: string,
  at: SourceRange,
  report: Report,
): number | undefined {
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only?.kind !== 'dimension' || (only.unit !== '' && only.unit !== 'deg')) {
    report(badValue(field, "a gradient's first argument is an angle, as in 180deg", at));
    return undefined;
  }
  return only.number;
}

export function readPaint(
  tokens: readonly ValueToken[],
  field: string,
  at: SourceRange,
  report: Report,
): Paint | undefined {
  const only = tokens.length === 1 ? tokens[0] : undefined;

  if (only?.kind === 'call' && only.name === 'linear-gradient') {
    const [angle, ...rest] = splitOnCommas(only.args);
    const degrees = readAngle(angle ?? [], field, only.range, report);
    const stops = readStops(rest, field, only.range, report);
    if (degrees === undefined || stops === undefined) return undefined;
    return linearGradient(degrees, stops as [GradientStop, GradientStop, ...GradientStop[]]);
  }

  if (only?.kind === 'call' && only.name === 'radial-gradient') {
    const [centre, radius, ...rest] = splitOnCommas(only.args);
    const cx = centre?.[0];
    const cy = centre?.[1];
    const r = radius?.[0];
    if (cx?.kind !== 'dimension' || cy?.kind !== 'dimension' || r?.kind !== 'dimension') {
      report(
        badValue(
          field,
          'a radial gradient reads as radial-gradient(<cx> <cy>, <radius>, <stops>)',
          only.range,
        ),
      );
      return undefined;
    }
    const stops = readStops(rest, field, only.range, report);
    if (stops === undefined) return undefined;
    return radialGradient(
      { x: cx.number, y: cy.number },
      r.number,
      stops as [GradientStop, GradientStop, ...GradientStop[]],
    );
  }

  const value = readColor(tokens, field, at, report);
  return value === undefined ? undefined : solid(value);
}

const LENGTH_UNITS = ['', 'px', '%', 'vw', 'vh'];

export function readLength(
  tokens: readonly ValueToken[],
  axis: Axis,
  context: LengthContext,
  field: string,
  at: SourceRange,
  report: Report,
): number | undefined {
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only?.kind !== 'dimension' || !LENGTH_UNITS.includes(only.unit)) {
    report(
      badValue(
        field,
        `'${describe(tokens)}' is not a length; units are px, %, vw and vh`,
        spanOf(tokens, at),
      ),
    );
    return undefined;
  }

  switch (only.unit) {
    case '%':
      return (only.number / 100) * (axis === 'w' ? context.parent.w : context.parent.h);
    case 'vw':
      return (only.number / 100) * context.frame.w;
    case 'vh':
      return (only.number / 100) * context.frame.h;
    default:
      return only.number;
  }
}

export function readNumber(
  tokens: readonly ValueToken[],
  field: string,
  at: SourceRange,
  report: Report,
): number | undefined {
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only?.kind !== 'dimension' || (only.unit !== '' && only.unit !== 'deg')) {
    report(badValue(field, `'${describe(tokens)}' is not a number`, spanOf(tokens, at)));
    return undefined;
  }
  return only.number;
}

export function readKeyword<Word extends string>(
  tokens: readonly ValueToken[],
  allowed: readonly Word[],
  field: string,
  at: SourceRange,
  report: Report,
): Word | undefined {
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only?.kind === 'ident' && (allowed as readonly string[]).includes(only.text)) {
    return only.text as Word;
  }
  report(
    badValue(
      field,
      `'${describe(tokens)}' is not one of ${allowed.join(', ')}`,
      spanOf(tokens, at),
    ),
  );
  return undefined;
}

export function readBoolean(
  tokens: readonly ValueToken[],
  field: string,
  at: SourceRange,
  report: Report,
): boolean | undefined {
  const word = readKeyword(tokens, ['true', 'false'] as const, field, at, report);
  return word === undefined ? undefined : word === 'true';
}

export interface FontShorthand {
  readonly family: string;
  readonly size: number;
  readonly weight?: number;
  readonly lineHeight?: number;
}

/**
 * `700 72px/1.05 "Inter"` — CSS's own shorthand, cut down to what a run needs.
 *
 * The family is quoted and last, which is what makes the rest positional without a
 * lookahead: everything before the string is a number, and the slash says which of the
 * two numbers around it is the leading.
 */
export function readFont(
  tokens: readonly ValueToken[],
  field: string,
  at: SourceRange,
  report: Report,
): FontShorthand | undefined {
  const family = tokens.find((token) => token.kind === 'string');
  if (family === undefined || family.text.trim() === '') {
    report(
      badValue(
        field,
        `'${describe(tokens)}' is not a font; write it as 700 72px/1.05 "Inter"`,
        spanOf(tokens, at),
      ),
    );
    return undefined;
  }

  const before = tokens.slice(0, tokens.indexOf(family));
  const slash = before.findIndex((token) => token.kind === 'slash');
  const sizeIndex = slash === -1 ? before.length - 1 : slash - 1;
  const size = before[sizeIndex];
  const weight = sizeIndex > 0 ? before[sizeIndex - 1] : undefined;
  const lineHeight = slash === -1 ? undefined : before[slash + 1];

  if (size?.kind !== 'dimension' || (size.unit !== '' && size.unit !== 'px')) {
    report(badValue(field, 'a font needs a size in px, as in 72px', spanOf(tokens, at)));
    return undefined;
  }
  if (weight !== undefined && weight.kind !== 'dimension') {
    report(badValue(field, "a font's weight is a number, as in 700", weight.range));
    return undefined;
  }
  if (lineHeight !== undefined && lineHeight.kind !== 'dimension') {
    report(badValue(field, "a font's line height is a multiplier, as in 1.05", lineHeight.range));
    return undefined;
  }

  return {
    family: family.text,
    size: size.number,
    ...(weight === undefined ? {} : { weight: weight.number }),
    ...(lineHeight === undefined ? {} : { lineHeight: lineHeight.number }),
  };
}

/** `2px #ffffff` or `2px #ffffff inside`. */
export function readStroke(
  tokens: readonly ValueToken[],
  field: string,
  at: SourceRange,
  report: Report,
): Stroke | undefined {
  const width = tokens[0];
  if (width?.kind !== 'dimension' || (width.unit !== '' && width.unit !== 'px')) {
    report(
      badValue(
        field,
        `'${describe(tokens)}' is not a stroke; write it as 2px #ffffff`,
        spanOf(tokens, at),
      ),
    );
    return undefined;
  }

  const rest = tokens.slice(1);
  const last = rest[rest.length - 1];
  const aligned =
    last?.kind === 'ident' && ['inside', 'center', 'outside'].includes(last.text)
      ? (last.text as Stroke['align'])
      : undefined;
  const paint = readPaint(aligned === undefined ? rest : rest.slice(0, -1), field, at, report);
  if (paint === undefined) return undefined;

  return { paint, width: width.number, align: aligned ?? 'center' };
}

export interface ShadowValue {
  readonly x: number;
  readonly y: number;
  readonly blur: number;
  readonly spread: number;
  readonly color: Color;
}

/** `0 4 12 #0008`, with an optional spread before the colour: `0 4 12 2 #0008`. */
export function readShadow(
  tokens: readonly ValueToken[],
  field: string,
  at: SourceRange,
  report: Report,
): ShadowValue | undefined {
  const numbers = tokens.filter((token) => token.kind === 'dimension');
  const rest = tokens.filter((token) => token.kind !== 'dimension');

  if (numbers.length < 3 || numbers.length > 4) {
    report(
      badValue(
        field,
        `'${describe(tokens)}' is not a shadow; write it as 0 4 12 #00000088`,
        spanOf(tokens, at),
      ),
    );
    return undefined;
  }

  const value = readColor(rest, field, at, report);
  if (value === undefined) return undefined;

  const [x, y, blur, spread] = numbers;
  return {
    x: x?.number ?? 0,
    y: y?.number ?? 0,
    blur: blur?.number ?? 0,
    spread: numbers.length === 4 ? (spread?.number ?? 0) : 0,
    color: value,
  };
}

/** `center`, `0.5`, or `0.5 1`. */
export function readAnchor(
  tokens: readonly ValueToken[],
  field: string,
  at: SourceRange,
  report: Report,
): { x: number; y: number } | undefined {
  const only = tokens.length === 1 ? tokens[0] : undefined;
  if (only?.kind === 'ident' && only.text === 'center') return { x: 0.5, y: 0.5 };

  const numbers = tokens.filter((token) => token.kind === 'dimension');
  if (numbers.length !== tokens.length || numbers.length < 1 || numbers.length > 2) {
    report(
      badValue(
        field,
        `'${describe(tokens)}' is not an anchor; write it as 0.5 0.5 or center`,
        spanOf(tokens, at),
      ),
    );
    return undefined;
  }

  const x = numbers[0]?.number ?? 0;
  const y = numbers[1]?.number ?? x;
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    report(
      badValue(field, 'an anchor is a point inside the node, between 0 and 1', spanOf(tokens, at)),
    );
    return undefined;
  }
  return { x, y };
}

/** `8`, or `[tl, tr, br, bl]` written as `8 8 0 0`. */
export function readRadius(
  tokens: readonly ValueToken[],
  field: string,
  at: SourceRange,
  report: Report,
): [number, number, number, number] | undefined {
  const numbers = tokens.filter((token) => token.kind === 'dimension');
  if (numbers.length !== tokens.length || (numbers.length !== 1 && numbers.length !== 4)) {
    report(
      badValue(
        field,
        `'${describe(tokens)}' is not a radius; write one number or four, as in 8 or 8 8 0 0`,
        spanOf(tokens, at),
      ),
    );
    return undefined;
  }

  const values = numbers.map((token) => token.number);
  const [a = 0, b = a, c = a, d = a] = values;
  return numbers.length === 1 ? [a, a, a, a] : [a, b, c, d];
}
