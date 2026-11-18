import { realpath } from 'node:fs/promises';
import { join } from 'node:path';

import {
  type DeliveryCheckState,
  type Size,
  type Trust,
  checkDelivery,
  readDeliveryRecord,
} from '@tyto/core';
import { workspaceDeliveryPorts } from '@tyto/io';

/**
 * Each delivery's exports checked against its record, for the Explorer (TYTO-757, ADR 0215).
 *
 * The same check `deliveries` gives a recipe, read through the same workspace port, so the badge
 * and a recipe never disagree: the images at the root of `delivery.exports`, by the size in their
 * header, against the formats the record owes at `delivery.sizes` over the format catalogue.
 *
 * Main reads it again after each burst the Explorer's watcher reports, and on opening a folder.
 * Only a trusted folder is read, as `deliveries` reads only there; a restricted one has no
 * badges. Nothing is written.
 */

/** What the Explorer shows on a delivery folder's row. */
export interface DeliveryBadge {
  readonly check: DeliveryCheckState;
  readonly problems: readonly string[];
}

/** How many problems a badge carries, so a folder of a hundred strays is not a hundred lines. */
export const DELIVERY_BADGE_PROBLEMS = 20;

/** How long one problem may be: a file name is a person's, and may be very long. */
export const DELIVERY_BADGE_PROBLEM_LENGTH = 2000;

export interface DeliveryChecksOptions {
  /** The open folder and its trust, asked on every read; `undefined` when none is open. */
  readonly place: () => Promise<{ readonly folder: string; readonly trust: Trust } | undefined>;
  /** `TYTO_HOME`, where the trust store lives. */
  readonly home: string;
  /** The format catalogue's sizes, which a name `delivery.sizes` leaves out falls back to. */
  readonly formatSizes: () => Promise<Readonly<Record<string, Size>>>;
}

export interface DeliveryChecks {
  /** Reads every delivery again; `true` when any badge changed. */
  refresh(): Promise<boolean>;
  /** The badge of the folder at a real path, or nothing for a folder that is no delivery. */
  badgeOf(realFolder: string): DeliveryBadge | undefined;
}

export function createDeliveryChecks(options: DeliveryChecksOptions): DeliveryChecks {
  let badges = new Map<string, DeliveryBadge>();
  /** Bumped on every refresh, so a slow read finishing after a newer one is dropped. */
  let generation = 0;

  async function read(): Promise<Map<string, DeliveryBadge>> {
    const found = new Map<string, DeliveryBadge>();
    const place = await options.place();
    if (place === undefined || place.trust !== 'trusted') return found;
    const ports = workspaceDeliveryPorts({
      workspaceFolder: place.folder,
      trust: () => place.trust,
      home: options.home,
      formatSizes: options.formatSizes,
    });
    const layout = await ports.layout();
    if (!layout.ok) return found;
    const listed = await ports.list(layout.value.parent, layout.value.exports ?? '.');
    if (!listed.ok) return found;
    for (const entry of listed.value) {
      if (entry.record === undefined) continue;
      const record = readDeliveryRecord(entry.record);
      if (!record.ok) continue;
      const check = checkDelivery({
        formats: record.value.formats,
        sizes: layout.value.sizes ?? {},
        images: entry.images ?? [],
        editables: entry.editables ?? 0,
      });
      let real: string;
      try {
        real = await realpath(join(place.folder, entry.path));
      } catch {
        continue;
      }
      found.set(real, {
        check: check.state,
        problems: check.problems
          .slice(0, DELIVERY_BADGE_PROBLEMS)
          .map((problem) => problem.slice(0, DELIVERY_BADGE_PROBLEM_LENGTH)),
      });
    }
    return found;
  }

  return {
    async refresh() {
      generation += 1;
      const mine = generation;
      const next = await read();
      if (mine !== generation) return false;
      const changed = !sameBadges(badges, next);
      badges = next;
      return changed;
    },
    badgeOf: (realFolder) => badges.get(realFolder),
  };
}

function sameBadges(
  a: ReadonlyMap<string, DeliveryBadge>,
  b: ReadonlyMap<string, DeliveryBadge>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [path, badge] of a) {
    const other = b.get(path);
    if (
      other?.check !== badge.check ||
      other.problems.length !== badge.problems.length ||
      other.problems.some((problem, index) => problem !== badge.problems[index])
    ) {
      return false;
    }
  }
  return true;
}
