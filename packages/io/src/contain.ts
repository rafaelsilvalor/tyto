import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Is `path` inside `root`?
 *
 * Written once because both adapters need it and a containment check done two ways is a
 * containment check that disagrees with itself. `relative` rather than `startsWith`:
 * comparing strings would let `/data/inbox-evil` pass as inside `/data/inbox`, and on
 * Windows it would disagree about separators and about case.
 *
 * Not a sandbox. A symlink inside `root` still leads out, and nothing here reads one's
 * target. It is a mistake boundary: a brief or a template that reaches for `../../../etc`
 * is a bug or a hostile input, and a renderer that read whatever it was pointed at would
 * embed the file in an image.
 */
export function isInside(root: string, path: string): boolean {
  const inside = relative(resolve(root), resolve(path));
  // Empty means the path *is* the root, which counts.
  return inside === '' || (!inside.startsWith('..') && !isAbsolute(inside));
}
