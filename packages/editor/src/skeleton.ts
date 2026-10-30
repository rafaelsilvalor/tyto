import { snippet } from '@codemirror/autocomplete';
import { type EditorView } from '@codemirror/view';
import { type SkeletonManifest, briefSkeleton } from '@tyto/core';

/**
 * Puts a new brief's skeleton into the editor (TYTO-275). The skeleton itself is computed in
 * `@tyto/core` (`template/skeleton.ts`), so a host with no editor — `tyto delivery new`
 * (TYTO-489) — writes the same text; it is re-exported here for the editor's callers.
 */
export {
  type ConfiguredSkeleton,
  type SkeletonManifest,
  briefSkeleton,
  inSkeleton,
  skeletonText,
} from '@tyto/core';

/**
 * Puts the skeleton into `view` between `from` and `to` — the whole document by default — and
 * selects its first field. Tab and Shift-Tab then move between fields, through the keymap
 * `snippet()` installs at `Prec.highest`, which is above vim's too.
 */
export function insertBriefSkeleton(
  view: EditorView,
  manifest: SkeletonManifest,
  from = 0,
  to: number = view.state.doc.length,
): void {
  snippet(briefSkeleton(manifest))(view, null, from, to);
}
