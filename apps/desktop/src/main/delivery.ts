import { relative } from 'node:path';

import {
  type BriefDelivery,
  type ResolvedDelivery,
  BUILT_IN_DELIVERY,
  deliveryOfBrief,
  diagnostic,
  planDelivery,
} from '@tyto/core';
import { createDelivery } from '@tyto/io';

/**
 * "Delivery: New…" in main (TYTO-489, ADR 0157 §5): the window sends a name and the brief's
 * text, and main makes the delivery in the folder it has open — the same plan (`planDelivery`)
 * and the same writer (`createDelivery`) as `tyto delivery new`, so the two cannot disagree.
 *
 * The name is checked here again, whatever the window checked as it was typed: the window's
 * check is for the person, this one is the guard. A refusal is the diagnostic's code and
 * message and nothing is written; ADR 0157 makes a delivery only in an open folder.
 */

export interface DeliveryLayout {
  /** The open folder, as its real path: what the delivery must stay inside. */
  readonly root: string;
  readonly delivery: ResolvedDelivery;
}

export type DeliveryMade =
  | { readonly ok: true; readonly brief: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** What answers when no folder is open: not a diagnostic, since no file is at fault. */
export const NO_FOLDER = 'no-folder';

/** A brief's delivery, with what its export renders (ADR 0157 §6). */
export interface FoundDelivery extends BriefDelivery {
  /** `delivery.formats` when a sheet writes it; absent, the brief's own decide. */
  readonly formats?: readonly string[];
  /** `delivery.types`, or `png`, as for a preset (ADR 0126). */
  readonly types: readonly string[];
}

/** The type a delivery's export writes when no sheet says, as for a preset (ADR 0126). */
export const DEFAULT_DELIVERY_TYPES: readonly string[] = ['png'];

export interface DeliveryService {
  create(name: string, brief: string): Promise<DeliveryMade>;
  /**
   * The delivery the brief at `path` belongs to in the open folder, or `undefined` (TYTO-490).
   * Asked on every tab switch, so it reads no disk: the layout is the one the open folder
   * already resolved, and the test is `deliveryOfBrief`'s, lexical.
   */
  of(path: string): FoundDelivery | undefined;
  /** Why a brief at `path` (or an unsaved one) has no delivery export: for the status bar. */
  notIn(path: string | undefined): { readonly code: string; readonly message: string };
}

export function createDeliveryService(options: {
  /** The open folder's layout, read on every call: a folder reopened changes it. */
  readonly layout: () => DeliveryLayout | undefined;
}): DeliveryService {
  return {
    async create(name, brief) {
      const layout = options.layout();
      if (layout === undefined) return { ok: false, code: NO_FOLDER, message: '' };
      const plan = planDelivery(layout.delivery, name);
      if (!plan.ok) return refusal(plan.error);
      // Paths in a refusal are relative to the folder: the status bar has one line for them.
      const shown = (path: string): string => relative(layout.root, path) || path;
      const made = await createDelivery(plan.value, { root: layout.root, brief, shown });
      if (!made.ok) return refusal(made.error);
      return { ok: true, brief: plan.value.brief };
    },

    of(path) {
      const layout = options.layout();
      if (layout === undefined) return undefined;
      const found = deliveryOfBrief(layout.delivery, path);
      if (found === undefined) return undefined;
      return {
        ...found,
        ...(layout.delivery.formats === undefined ? {} : { formats: layout.delivery.formats }),
        types: layout.delivery.types ?? DEFAULT_DELIVERY_TYPES,
      };
    },

    notIn(path) {
      const layout = options.layout();
      const problem = diagnostic('E_BRIEF_NOT_IN_DELIVERY', {
        path: path === undefined ? 'untitled' : shownIn(layout?.root, path),
        folder: layout?.delivery.brief ?? BUILT_IN_DELIVERY.brief,
        parent: layout === undefined ? '.' : shownIn(layout.root, layout.delivery.parent),
      });
      return { code: problem.code, message: problem.message };
    },
  };
}

/** `path` relative to the open folder, as the status bar shows paths; `.` for the folder. */
function shownIn(root: string | undefined, path: string): string {
  return root === undefined ? path : relative(root, path) || '.';
}

function refusal(
  problems: readonly { readonly code: string; readonly message: string }[],
): DeliveryMade {
  const first = problems[0];
  return { ok: false, code: first?.code ?? 'failed', message: first?.message ?? '' };
}
