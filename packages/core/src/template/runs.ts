import { run } from './values.js';
import { rememberOrigin } from '../text/origin.js';
import type { ColorChannels } from './values.js';
import type { Inline, RichText } from '../brief/ast.js';
import type { TextRun } from '../scene/nodes.js';
import type { FontRef, Paint } from '../scene/primitives.js';

/**
 * `RichText` from a brief → `TextRun[]` for a `text()` node.
 *
 * The brief says what is emphasised; the template says what emphasis looks like. This is
 * the seam: bold and italic arrive as structure and leave as a weight and a style, and a
 * `Break` arrives as structure and leaves as a `LineBreak` run rather than as a `\n` in a
 * string (ADR 0016).
 *
 * Marks are the part no default can cover. `{cor:laranja}` names a colour in the template's
 * own vocabulary, and only the template knows what `laranja` is, so it supplies the
 * mapping. A mark nothing maps passes its children through unchanged — a template that
 * does not use a mark should not have to refuse it.
 */

/** The style text takes where the brief says nothing about it. */
export interface RunStyle {
  readonly font: FontRef;
  readonly size: number;
  readonly color: string | ColorChannels | Paint;
  readonly weight?: number;
  readonly style?: 'normal' | 'italic';
  readonly decoration?: 'underline' | 'line-through';
}

export interface RunsOptions {
  /** The weight `**bold**` takes. 700 is what a template that says nothing means. */
  readonly bold?: number;
  /** What `{key:value}` does to the runs it wraps; `undefined` leaves them alone. */
  readonly mark?: (key: string, value: string) => Partial<RunStyle> | undefined;
}

const BOLD = 700;

function styled(inline: Inline, style: RunStyle, options: RunsOptions): RunStyle {
  switch (inline.kind) {
    case 'bold':
      return { ...style, weight: options.bold ?? BOLD };
    case 'italic':
      return { ...style, style: 'italic' };
    case 'mark':
      return { ...style, ...options.mark?.(inline.key, inline.value) };
    default:
      return style;
  }
}

function append(target: TextRun[], text: RichText, style: RunStyle, options: RunsOptions): void {
  for (const inline of text) {
    switch (inline.kind) {
      case 'text': {
        // Empty text would produce a run that draws nothing and still counts as one.
        if (inline.value === '') break;
        const produced = run(inline.value, style);
        // Where it came from, so W_TEXT_OVERFLOW can point at the directive rather than at
        // a node id. Kept outside the IR; see `text/origin.ts`.
        rememberOrigin(produced, inline.range);
        target.push(produced);
        break;
      }
      case 'break':
        target.push({ kind: 'break' });
        break;
      default:
        append(target, inline.children, styled(inline, style, options), options);
        break;
    }
  }
}

export function runsOf(text: RichText, base: RunStyle, options: RunsOptions = {}): TextRun[] {
  const runs: TextRun[] = [];
  append(runs, text, base, options);
  return runs;
}
