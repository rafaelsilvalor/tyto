import type { RefuseAnswer } from '@tyto/command-line';

import type { CatalogueKey } from '../../shared/i18n/catalogue.js';
import type { RefusalOffer, WindowRefusal } from './cli-refusals.js';

/**
 * **A refusal that offers the window's own way** (TYTO-726, ADR 0159 note of 2026-11-15). There
 * is no "allow anyway": each refusal with a window equivalent offers that equivalent, in a native
 * box that names what it acts on, and a yes goes through the function the window's own control
 * calls. The box never only asks "are you sure?", and where the yes is stronger than what was
 * typed — a trust that is saved, a switch that stays off — it says so.
 */

/** The box Electron's `dialog.showMessageBox` shows; no is the default and what Escape answers. */
export interface OfferBox {
  readonly type: 'question';
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly [string, string];
  readonly defaultId: 1;
  readonly cancelId: 1;
}

type Say = (key: CatalogueKey) => string;

const KEYS = {
  trust: ['cli.offer.trust.message', 'cli.offer.trust.detail', 'cli.offer.trust.yes'],
  signin: ['cli.offer.signin.message', 'cli.offer.signin.detail', 'cli.offer.signin.yes'],
  signout: ['cli.offer.signout.message', 'cli.offer.signout.detail', 'cli.offer.signout.yes'],
  apply: ['cli.offer.apply.message', 'cli.offer.apply.detail', 'cli.offer.apply.yes'],
  watch: ['cli.offer.watch.message', 'cli.offer.watch.detail', 'cli.offer.watch.yes'],
} as const satisfies Record<string, readonly [CatalogueKey, CatalogueKey, CatalogueKey]>;

/** What the box's sentences name, filled into `{folder}`, `{plugin}`, `{id}` and `{recipe}`. */
function fill(text: string, offer: RefusalOffer): string {
  const values: Record<string, string> =
    offer.kind === 'signin'
      ? { plugin: offer.plugin, id: offer.id }
      : offer.kind === 'apply'
        ? { recipe: offer.recipe }
        : { folder: offer.folder };
  return text.replace(/\{(\w+)\}/gu, (whole, name: string) => values[name] ?? whole);
}

/** The box for one offer, in the window's language. Pure, so every sentence is tested. */
export function offerBox(offer: RefusalOffer, say: Say): OfferBox {
  const kind = offer.kind === 'signin' && offer.out ? 'signout' : offer.kind;
  const [message, detail, yes] = KEYS[kind];
  return {
    type: 'question',
    message: fill(say(message), offer),
    detail: fill(say(detail), offer),
    buttons: [say(yes), say('cli.offer.no')],
    defaultId: 1,
    cancelId: 1,
  };
}

/**
 * What a yes runs: each the function behind the window's own control, never a path of its own.
 * `trust` is `workspace:trust`'s, `signin` the plugins screen's `signin:start` / `signin:out`,
 * `openRecipe` opens the file as a tab, and `autoRunOff` is `queue:set-auto-run`'s.
 */
export interface OfferActions {
  /** True once the folder is trusted and saved; false when trust.json could not be written. */
  trust(folder: string): Promise<boolean>;
  signin(
    plugin: string,
    id: string,
    out: boolean,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  openRecipe(recipe: string): Promise<void>;
  autoRunOff(): Promise<void>;
}

/**
 * The answer the command line gets for a refusal: the sentence on no, or on a yes the window's
 * own way, which either clears `--trust`, runs the command as typed, or ends the run as done.
 */
export async function settleRefusal(
  refusal: WindowRefusal,
  ask: (box: OfferBox) => Promise<boolean>,
  actions: OfferActions,
  say: Say,
): Promise<RefuseAnswer> {
  const { offer } = refusal;
  if (offer === undefined) return refusal.message;
  if (!(await ask(offerBox(offer, say)))) return refusal.message;

  switch (offer.kind) {
    case 'trust':
      return (await actions.trust(offer.folder))
        ? { without: ['trust'] }
        : `${offer.folder} could not be trusted: trust.json was not written. See the Problems panel.`;
    case 'signin': {
      const done = await actions.signin(offer.plugin, offer.id, offer.out);
      if (!done.ok) return `the window's sign-in did not finish: ${done.message}`;
      return {
        handled: offer.out
          ? `Signed out of ${offer.plugin} (${offer.id}) in the window, as the plugins screen does.`
          : `Signed in to ${offer.plugin} (${offer.id}) in the window, as the plugins screen does.`,
      };
    }
    case 'apply':
      await actions.openRecipe(offer.recipe);
      return {
        handled: `Opened ${offer.recipe} in its notebook. Run it there and click Apply on each plan; nothing was applied.`,
      };
    case 'watch':
      await actions.autoRunOff();
      return undefined;
  }
}

/**
 * The recipe a yes asked the window to open, by run, until the window takes it. The window only
 * names the run, never a path, as `cli:open-diagnostic` names a row (ADR 0159 decision 7).
 */
export class OfferedRecipes {
  private readonly kept = new Map<string, string>();

  constructor(private readonly limit = 5) {}

  keep(runId: string, recipe: string): void {
    this.kept.set(runId, recipe);
    const oldest = this.kept.keys().next().value;
    if (this.kept.size > this.limit && oldest !== undefined) this.kept.delete(oldest);
  }

  /** The recipe once: a second ask for the same run opens nothing. */
  take(runId: string): string | undefined {
    const recipe = this.kept.get(runId);
    this.kept.delete(runId);
    return recipe;
  }
}
