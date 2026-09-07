import { TemplateError } from './errors.js';
import type {
  AssetRef,
  Color,
  Fit,
  FontRef,
  GradientStop,
  Paint,
  UnitPoint,
} from '../scene/primitives.js';
import type { LineBreak, TextSpan } from '../scene/nodes.js';

/**
 * The leaf values a template writes, in the form a template author wants to write them.
 *
 * `docs/ir-schema.md` says colour is structured so that no exporter ever parses a string,
 * and that "whoever writes `#ff0000` writes it in a brief or a template, and the template
 * SDK converts it". This file is that conversion, and the only place in the codebase that
 * reads a hex colour.
 */

/** At least one, at the type level: what a text needs and a gradient needs two of. */
export type NonEmpty<T> = readonly [T, ...T[]];
export type AtLeastTwo<T> = readonly [T, T, ...T[]];

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** `#rgb` and `#rgba` double each digit, the way CSS does: `#f80` is `#ff8800`. */
function expandShorthand(digits: string): string {
  return digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits;
}

function channel(hex: string, index: number): number {
  return Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
}

/** The channels, with alpha optional because most colours are opaque. */
export interface ColorChannels {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a?: number;
}

/**
 * A colour, from `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` or the channels themselves.
 *
 * Alpha is 0..1 in the IR and two hex digits in the input, so `#00000080` is `a: 0.502`
 * and not `a: 128`. There are no named colours: `white` belongs to the template language,
 * which has a stylesheet to read it from, not to a function whose argument is a value.
 */
export function color(value: string | ColorChannels): Color {
  if (typeof value !== 'string') {
    return { r: value.r, g: value.g, b: value.b, a: value.a ?? 1 };
  }
  if (!HEX.test(value)) {
    throw new TemplateError('color', `'${value}' is not a hex colour such as '#ff5900'`);
  }

  const digits = expandShorthand(value.slice(1));
  return {
    r: channel(digits, 0),
    g: channel(digits, 1),
    b: channel(digits, 2),
    a: digits.length === 8 ? Math.round((channel(digits, 3) / 255) * 1000) / 1000 : 1,
  };
}

export function solid(value: string | ColorChannels): Paint {
  return { kind: 'solid', color: color(value) };
}

export function stop(offset: number, value: string | ColorChannels): GradientStop {
  return { offset, color: color(value) };
}

/** Degrees clockwise from "up", the way a designer states a gradient angle. */
export function linearGradient(angle: number, stops: AtLeastTwo<GradientStop>): Paint {
  return { kind: 'linear-gradient', angle, stops: [...stops] };
}

export function radialGradient(
  center: UnitPoint,
  radius: number,
  stops: AtLeastTwo<GradientStop>,
): Paint {
  return { kind: 'radial-gradient', center, radius, stops: [...stops] };
}

export function imagePaint(asset: AssetRef, fit: Fit = 'cover'): Paint {
  return { kind: 'image', asset, fit };
}

/** A bundled family by name; a file-backed one needs the path the brief resolved. */
export function font(family: string, path?: string): FontRef {
  return path === undefined ? { family, source: 'bundled' } : { family, source: 'file', path };
}

export interface RunOptions {
  readonly font: FontRef;
  readonly size: number;
  readonly color: string | ColorChannels | Paint;
  readonly weight?: number;
  readonly style?: 'normal' | 'italic';
  readonly decoration?: 'underline' | 'line-through';
}

/** A paint passes through; anything else is a colour on its way to becoming one. */
function paintOf(value: string | ColorChannels | Paint): Paint {
  return typeof value === 'object' && 'kind' in value ? value : solid(value);
}

/**
 * One run of text in one style. Weight defaults to 400 and style to normal, because a
 * template that says neither means body text.
 */
export function run(text: string, options: RunOptions): TextSpan {
  return {
    kind: 'text',
    text,
    font: options.font,
    size: options.size,
    weight: options.weight ?? 400,
    style: options.style ?? 'normal',
    color: paintOf(options.color),
    ...(options.decoration !== undefined ? { decoration: options.decoration } : {}),
  };
}

/**
 * A line ends here (ADR 0016).
 *
 * It takes no options because it has no glyph — the runs around it decide what the line it
 * ends looks like. A template writes `[run('Turma'), lineBreak(), run('nova')]` for text
 * the author broke in two.
 */
export function lineBreak(): LineBreak {
  return { kind: 'break' };
}
