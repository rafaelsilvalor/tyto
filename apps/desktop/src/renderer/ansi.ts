/**
 * Colours a command printed, read off its SGR escape sequences (TYTO-496).
 *
 * A terminal draws `ESC [ 31 m` as red; the command panel shows text, so it reads the
 * sequences into runs of text with a style and drops every other escape (cursor moves, titles,
 * hyperlinks) rather than printing it as noise. The sixteen named colours become classes that
 * `shell.css` maps to the window's own tokens, so a theme that changes red changes the
 * panel's red too. A 256-colour or a true colour has no token to follow and stays the exact
 * colour the command asked for.
 *
 * The style carries across calls: a command that prints `ESC[31m` in one chunk and the text
 * in the next is red in both, so the panel keeps one {@link AnsiState} per run.
 */

export interface AnsiStyle {
  /** A named colour, 0 to 15 (8 to 15 are the bright ones), or a CSS colour. */
  readonly foreground?: number | string;
  readonly background?: number | string;
  readonly bold?: true;
  readonly dim?: true;
  readonly italic?: true;
  readonly underline?: true;
  readonly inverse?: true;
}

export interface AnsiRun {
  readonly text: string;
  readonly style: AnsiStyle;
}

export interface AnsiState {
  style: AnsiStyle;
  /** An escape cut in half by the end of a chunk, finished by the next one. */
  pending: string;
}

export const freshAnsiState = (): AnsiState => ({ style: {}, pending: '' });

/** CSI (`ESC [ … final`), OSC (`ESC ] … BEL` or `ESC ] … ESC \`) and any two-byte escape. */
const ESCAPE =
  // eslint-disable-next-line no-control-regex -- the escape character is what this reads
  /\u001b(?:\[([0-?]*)[ -/]*([@-~])|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/gu;
/** An escape the chunk ends inside of, kept for the next chunk. */
// eslint-disable-next-line no-control-regex -- the escape character is what this reads
const UNFINISHED = /\u001b(?:\[[0-?]*[ -/]*|\][^\u0007\u001b]*\u001b?)?$/u;

/** Three channels as a CSS hex colour: a function call would be a literal the token guard refuses. */
const hexColour = (red: number, green: number, blue: number): string =>
  `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;

/** The 256-colour cube and grey ramp above the sixteen named colours, as CSS. */
function indexedColour(index: number): number | string {
  if (index < 16) return index;
  if (index >= 232) {
    const grey = 8 + (index - 232) * 10;
    return hexColour(grey, grey, grey);
  }
  const cube = index - 16;
  const level = (value: number): number => (value === 0 ? 0 : 55 + value * 40);
  return hexColour(level(Math.floor(cube / 36)), level(Math.floor(cube / 6) % 6), level(cube % 6));
}

/** The style after one SGR sequence's parameters. */
export function applySgr(style: AnsiStyle, parameters: string): AnsiStyle {
  const codes =
    parameters === '' ? [0] : parameters.split(/[;:]/u).map((code) => Number(code) || 0);
  let next: { -readonly [Key in keyof AnsiStyle]: AnsiStyle[Key] } = { ...style };
  for (let at = 0; at < codes.length; at += 1) {
    const code = codes[at] ?? 0;
    if (code === 0) next = {};
    else if (code === 1) next.bold = true;
    else if (code === 2) next.dim = true;
    else if (code === 3) next.italic = true;
    else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true;
    else if (code === 22) {
      delete next.bold;
      delete next.dim;
    } else if (code === 23) delete next.italic;
    else if (code === 24) delete next.underline;
    else if (code === 27) delete next.inverse;
    else if (code >= 30 && code <= 37) next.foreground = code - 30;
    else if (code >= 90 && code <= 97) next.foreground = code - 90 + 8;
    else if (code === 39) delete next.foreground;
    else if (code >= 40 && code <= 47) next.background = code - 40;
    else if (code >= 100 && code <= 107) next.background = code - 100 + 8;
    else if (code === 49) delete next.background;
    else if (code === 38 || code === 48) {
      const key = code === 38 ? 'foreground' : 'background';
      const mode = codes[at + 1];
      if (mode === 5) {
        next[key] = indexedColour(codes[at + 2] ?? 0);
        at += 2;
      } else if (mode === 2) {
        const [red, green, blue] = [codes[at + 2], codes[at + 3], codes[at + 4]].map((value) =>
          Math.max(0, Math.min(255, Math.round(value ?? 0))),
        );
        next[key] = hexColour(red ?? 0, green ?? 0, blue ?? 0);
        at += 4;
      }
    }
  }
  return next;
}

/** Reads one chunk of output into styled runs, carrying the style in `state`. */
export function readAnsi(state: AnsiState, chunk: string): readonly AnsiRun[] {
  let text = state.pending + chunk;
  state.pending = '';
  const unfinished = UNFINISHED.exec(text);
  if (unfinished !== null && unfinished[0] !== '') {
    state.pending = unfinished[0];
    text = text.slice(0, unfinished.index);
  }

  const runs: AnsiRun[] = [];
  let from = 0;
  const push = (piece: string): void => {
    if (piece === '') return;
    const last = runs.at(-1);
    if (last !== undefined && last.style === state.style) {
      runs[runs.length - 1] = { text: last.text + piece, style: last.style };
    } else {
      runs.push({ text: piece, style: state.style });
    }
  };
  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(from, match.index));
    from = match.index + match[0].length;
    // Only `m` changes how text looks; every other escape is dropped.
    if (match[2] === 'm') state.style = applySgr(state.style, match[1] ?? '');
  }
  push(text.slice(from));
  return runs;
}

/** The classes and inline style one run is drawn with. */
export function ansiPresentation(style: AnsiStyle): { classes: string; css: string } {
  const classes: string[] = [];
  const css: string[] = [];
  // Inverse swaps the two; `ansi-inverse` swaps the window's own text and surface for the
  // half that names no colour, and a named colour's class, later in `shell.css`, wins.
  const foreground = style.inverse ? style.background : style.foreground;
  const background = style.inverse ? style.foreground : style.background;
  if (style.inverse) classes.push('ansi-inverse');
  if (typeof foreground === 'number') classes.push(`ansi-fg-${String(foreground)}`);
  else if (foreground !== undefined) css.push(`color: ${foreground}`);
  if (typeof background === 'number') classes.push(`ansi-bg-${String(background)}`);
  else if (background !== undefined) css.push(`background: ${background}`);
  if (style.bold) classes.push('ansi-bold');
  if (style.dim) classes.push('ansi-dim');
  if (style.italic) classes.push('ansi-italic');
  if (style.underline) classes.push('ansi-underline');
  return { classes: classes.join(' '), css: css.join('; ') };
}
