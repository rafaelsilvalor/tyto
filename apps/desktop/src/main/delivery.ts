import { relative } from 'node:path';

import { type ResolvedDelivery, planDelivery } from '@tyto/core';
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

export interface DeliveryService {
  create(name: string, brief: string): Promise<DeliveryMade>;
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
  };
}

function refusal(
  problems: readonly { readonly code: string; readonly message: string }[],
): DeliveryMade {
  const first = problems[0];
  return { ok: false, code: first?.code ?? 'failed', message: first?.message ?? '' };
}
