import { deliveryNameOf } from '@tyto/core';

import type { IpcResponse } from '../../shared/ipc.js';
import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';
import type { CommandBarAsk, CommandBarPick, CommandEntry } from './command-bar.js';

/**
 * "Delivery: New…" (TYTO-489, ADR 0157 §5), the window's half: two questions in the command bar
 * — the name, then a template or none — and the answer from main.
 *
 * The name is checked as it is typed, by the rule `core` applies (`deliveryNameOf`), so a person
 * sees why before pressing Enter; main checks it again, and main's is the check that counts. The
 * template list is New brief from template's, with "No template" first: ADR 0157 makes the
 * template optional, and an empty brief opens with the "/" menu, which writes a skeleton into
 * a brief holding only the "/". A refusal is a sentence in the status bar, never a dialog.
 */

/** The id of "No template": empty, which no template's name can be. */
export const NO_TEMPLATE = '';

export type DeliveryAnswer = IpcResponse<'delivery:new'>;
export type DeliveryMade = Extract<DeliveryAnswer, { ok: true }>;

export interface DeliveryNewHost {
  readonly locale: () => Locale;
  readonly ask: (request: CommandBarAsk) => void;
  readonly pick: (request: CommandBarPick) => void;
  /** New brief from template's rows, as the bar shows them. */
  readonly templates: () => readonly CommandEntry[];
  /** The skeleton text of the template `name` picks, as New brief from template writes it. */
  readonly skeletonOf: (name: string) => string | undefined;
  /** Main's `delivery:new`, with the tab id the window chose. */
  readonly create: (name: string, brief: string) => Promise<DeliveryAnswer>;
  /** The brief is open: show it, reveal it, and with no template open the "/" menu on it. */
  readonly opened: (made: DeliveryMade, withTemplate: boolean) => void;
  /** A sentence in the status bar, heard by a screen reader. */
  readonly notice: (text: string) => void;
}

/**
 * Whether the command is offered: only with a folder open, where ADR 0157 makes a delivery. The
 * bar, the key and the File menu all ask it, so the menu item is greyed with no folder.
 */
export function deliveryOffered(
  workspace: { readonly folder: string | null } | undefined,
): boolean {
  return workspace !== undefined && workspace.folder !== null;
}

/** Why `text` cannot be a delivery's name, in the diagnostic's own words, or nothing. */
export function deliveryNameProblem(text: string): string | undefined {
  const named = deliveryNameOf(text);
  return named.ok ? undefined : (named.error[0]?.message ?? '');
}

export function startDeliveryNew(host: DeliveryNewHost): void {
  const say = (key: CatalogueKey): string => translate(host.locale(), key);
  host.ask({
    placeholder: say('delivery.name.placeholder'),
    check: deliveryNameProblem,
    accept: (name) => {
      host.pick({
        entries: [{ id: NO_TEMPLATE, label: say('delivery.template.none') }, ...host.templates()],
        placeholder: say('delivery.template.placeholder'),
        highlight: () => undefined,
        choose: (template) => {
          void make(host, name, template === NO_TEMPLATE ? undefined : template);
        },
        cancel: () => undefined,
      });
    },
    cancel: () => undefined,
  });
}

async function make(
  host: DeliveryNewHost,
  name: string,
  template: string | undefined,
): Promise<void> {
  const brief = template === undefined ? '' : (host.skeletonOf(template) ?? '');
  const answer = await host.create(name, brief);
  if (answer.ok) {
    host.opened(answer, template !== undefined);
    return;
  }
  const locale = host.locale();
  host.notice(
    answer.code === 'no-folder'
      ? translate(locale, 'delivery.noFolder')
      : translate(locale, 'delivery.refused').replace('{problem}', answer.message),
  );
}
