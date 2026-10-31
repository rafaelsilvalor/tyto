import type { GalleryEntryView } from '../../shared/ipc.js';

/**
 * What the gallery screen decides about its cards (TYTO-504), apart from the element that draws
 * them, so the rules are tested without a window (ADR 0105).
 *
 * **A card offers at most one action**, and only what the person can click to change: Install
 * for an entry no plugin file holds, Update for one some file pins at an older tag. An entry
 * this Tyto cannot load offers neither, whatever its state, because install and update would
 * both refuse it (`E_GALLERY_ENGINE`).
 */

export const GALLERY_FILTERS = ['all', 'templates', 'plugins', 'installed', 'updates'] as const;
export type GalleryFilter = (typeof GALLERY_FILTERS)[number];

export type CardAction =
  | { readonly kind: 'install' }
  | { readonly kind: 'installed' }
  | { readonly kind: 'update'; readonly from: readonly string[]; readonly to: string }
  | { readonly kind: 'incompatible'; readonly engine: string };

export function cardAction(entry: GalleryEntryView): CardAction {
  if (!entry.compatible) return { kind: 'incompatible', engine: entry.engine };
  if (entry.state === 'not installed') return { kind: 'install' };
  if (entry.state === 'installed') return { kind: 'installed' };
  return { kind: 'update', from: entry.pinned, to: entry.latest };
}

/** Whether `entry` belongs under `filter`. Installed counts an entry with an update too. */
export function matchesFilter(entry: GalleryEntryView, filter: GalleryFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'templates':
      return entry.kind === 'template';
    case 'plugins':
      return entry.kind === 'plugin';
    case 'installed':
      return entry.state !== 'not installed';
    case 'updates':
      return entry.state === 'update available';
  }
}

/** How many entries each filter shows, for its label. */
export function filterCounts(
  entries: readonly GalleryEntryView[],
): Readonly<Record<GalleryFilter, number>> {
  const counts = Object.fromEntries(GALLERY_FILTERS.map((filter) => [filter, 0])) as Record<
    GalleryFilter,
    number
  >;
  for (const entry of entries) {
    for (const filter of GALLERY_FILTERS) if (matchesFilter(entry, filter)) counts[filter] += 1;
  }
  return counts;
}
