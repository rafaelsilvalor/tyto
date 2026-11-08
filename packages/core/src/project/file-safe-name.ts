/**
 * One part of a file name, safe on every file system a delivery or a workspace lands on
 * (ADR 0053, ADR 0172).
 *
 * Anything a file system or a URL would argue about is collapsed to `-`, and leading dots and
 * dashes go too: `.slide` would be a hidden file on Unix, and a file nobody can see in a folder
 * listing is a file nobody knows was produced. A part that sanitises away is `untitled`, never
 * an empty name.
 *
 * Written once, here, for every caller that names a file after what a person wrote: the
 * pipeline names an artwork after its format, and the recipe's `to-brief` names a brief after
 * a column. Two callers that sanitised differently would answer "which file is this?" two ways.
 */
export function fileSafeName(part: string): string {
  return part.replace(UNSAFE, '-').replace(/^[.-]+/u, '') || 'untitled';
}

const UNSAFE = /[^a-zA-Z0-9._-]+/gu;
