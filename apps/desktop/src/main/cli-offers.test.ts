import { describe, expect, it } from 'vitest';

import { type CatalogueKey, translate } from '../../shared/i18n/index.js';
import { type OfferActions, OfferedRecipes, offerBox, settleRefusal } from './cli-offers.js';
import {
  APPLY_REFUSED,
  MCP_REFUSED,
  type RefusalOffer,
  SIGNIN_REFUSED,
  TRUST_REFUSED,
  WATCH_REFUSED,
  type WindowRefusal,
} from './cli-refusals.js';

/**
 * TYTO-726, ADR 0159 note of 2026-11-15: each refusal with a window equivalent offers it in a
 * box naming what it acts on; no keeps the refusal, and a yes runs the window's own function.
 */

const en = (key: CatalogueKey): string => translate('en', key);
const pt = (key: CatalogueKey): string => translate('pt-BR', key);

const TRUST: RefusalOffer = { kind: 'trust', folder: 'C:\\work\\campanha' };
const SIGNIN: RefusalOffer = { kind: 'signin', plugin: 'google', id: 'drive', out: false };
const SIGNOUT: RefusalOffer = { kind: 'signin', plugin: 'google', id: 'drive', out: true };
const APPLY: RefusalOffer = { kind: 'apply', recipe: 'C:\\work\\flows\\weekly.recipe' };
const WATCH: RefusalOffer = { kind: 'watch', folder: 'C:\\Fila' };

/** Every call a yes made, in order, so a test reads which control's function ran. */
function recorder(overrides: Partial<OfferActions> = {}) {
  const calls: string[] = [];
  const actions: OfferActions = {
    trust: (folder) => {
      calls.push(`trust ${folder}`);
      return Promise.resolve(true);
    },
    signin: (plugin, id, out) => {
      calls.push(`${out ? 'signout' : 'signin'} ${plugin} ${id}`);
      return Promise.resolve({ ok: true });
    },
    openRecipe: (recipe) => {
      calls.push(`open ${recipe}`);
      return Promise.resolve();
    },
    autoRunOff: () => {
      calls.push('auto-run off');
      return Promise.resolve();
    },
    ...overrides,
  };
  return { calls, actions };
}

const answer = (yes: boolean) => () => Promise.resolve(yes);

describe('the box an offer shows', () => {
  it.each([TRUST, SIGNIN, SIGNOUT, APPLY, WATCH])(
    'names what it acts on and defaults to no: %j',
    (offer) => {
      for (const say of [en, pt]) {
        const box = offerBox(offer, say);
        const named =
          offer.kind === 'signin'
            ? [offer.plugin, offer.id]
            : [offer.kind === 'apply' ? offer.recipe : offer.folder];
        for (const name of named) expect(box.message).toContain(name);
        expect(box.message).not.toMatch(/\{\w+\}/u);
        expect(box.detail).not.toMatch(/\{\w+\}/u);
        expect(box.buttons[1]).toBe(say('cli.offer.no'));
        expect(box.defaultId).toBe(1);
        expect(box.cancelId).toBe(1);
      }
    },
  );

  it('says a trust is saved, and how to take it back, because --trust never was', () => {
    const box = offerBox(TRUST, en);

    expect(box.detail).toContain('one run only');
    expect(box.detail).toContain('saves it in trust.json');
    expect(box.detail).toContain('tyto trust remove');
    expect(box.detail).toContain('Workspace: Manage Trust');
    expect(offerBox(TRUST, pt).detail).toContain('tyto trust remove');
  });

  it('says Render automatically stays off until it is turned back on in the queue panel', () => {
    expect(offerBox(WATCH, en).detail).toContain(
      'Render automatically stays off until you turn it back on in the queue panel',
    );
    expect(offerBox(WATCH, pt).detail).toContain('fica desligado até você ligá-lo de novo');
  });

  it('tells a sign-in from a sign-out, and leaves the keychain alone in both', () => {
    expect(offerBox(SIGNIN, en).buttons[0]).toBe('Sign in');
    expect(offerBox(SIGNOUT, en).buttons[0]).toBe('Sign out');
    expect(offerBox(SIGNIN, en).detail).toContain('system keychain');
    expect(offerBox(SIGNOUT, en).detail).toContain('system keychain');
  });

  it('says opening the notebook applies nothing', () => {
    expect(offerBox(APPLY, en).detail).toContain('Opening it applies nothing');
  });
});

describe('settling a refusal', () => {
  const refused = (message: string, offer?: RefusalOffer): WindowRefusal =>
    offer === undefined ? { message } : { message, offer };

  it('refuses mcp with no box', async () => {
    const asked: unknown[] = [];
    const { calls, actions } = recorder();

    const settled = await settleRefusal(
      refused(MCP_REFUSED),
      (box) => {
        asked.push(box);
        return Promise.resolve(true);
      },
      actions,
      en,
    );

    expect(settled).toBe(MCP_REFUSED);
    expect(asked).toEqual([]);
    expect(calls).toEqual([]);
  });

  it.each([
    [TRUST_REFUSED, TRUST],
    [SIGNIN_REFUSED, SIGNIN],
    [SIGNIN_REFUSED, SIGNOUT],
    [APPLY_REFUSED, APPLY],
    [WATCH_REFUSED, WATCH],
  ])('keeps the refusal and runs nothing on no: %s', async (message, offer) => {
    const { calls, actions } = recorder();

    expect(await settleRefusal(refused(message, offer), answer(false), actions, en)).toBe(message);
    expect(calls).toEqual([]);
  });

  it('trusts the folder through the window, then runs without --trust', async () => {
    const { calls, actions } = recorder();

    expect(await settleRefusal(refused(TRUST_REFUSED, TRUST), answer(true), actions, en)).toEqual({
      without: ['trust'],
    });
    expect(calls).toEqual(['trust C:\\work\\campanha']);
  });

  it('stays refused when trust.json could not be written', async () => {
    const { actions } = recorder({ trust: () => Promise.resolve(false) });

    const settled = await settleRefusal(refused(TRUST_REFUSED, TRUST), answer(true), actions, en);

    expect(settled).toContain('could not be trusted');
  });

  it('signs in and out through the window, and the command never runs', async () => {
    const { calls, actions } = recorder();

    expect(await settleRefusal(refused(SIGNIN_REFUSED, SIGNIN), answer(true), actions, en)).toEqual(
      {
        handled: 'Signed in to google (drive) in the window, as the plugins screen does.',
      },
    );
    expect(
      await settleRefusal(refused(SIGNIN_REFUSED, SIGNOUT), answer(true), actions, en),
    ).toEqual({
      handled: 'Signed out of google (drive) in the window, as the plugins screen does.',
    });
    expect(calls).toEqual(['signin google drive', 'signout google drive']);
  });

  it("says why the window's sign-in did not finish", async () => {
    const { actions } = recorder({
      signin: () => Promise.resolve({ ok: false, message: 'the browser was closed' }),
    });

    expect(await settleRefusal(refused(SIGNIN_REFUSED, SIGNIN), answer(true), actions, en)).toBe(
      "the window's sign-in did not finish: the browser was closed",
    );
  });

  it('opens the recipe in its notebook and applies nothing', async () => {
    const { calls, actions } = recorder();

    const settled = await settleRefusal(refused(APPLY_REFUSED, APPLY), answer(true), actions, en);

    expect(settled).toMatchObject({ handled: expect.stringContaining('nothing was applied') });
    expect(calls).toEqual(['open C:\\work\\flows\\weekly.recipe']);
  });

  it('turns auto-run off, then lets the watch run as typed', async () => {
    const { calls, actions } = recorder();

    expect(
      await settleRefusal(refused(WATCH_REFUSED, WATCH), answer(true), actions, en),
    ).toBeUndefined();
    expect(calls).toEqual(['auto-run off']);
  });
});

describe('the recipes a yes offered', () => {
  it('hands each run its recipe once, and lets the oldest go', () => {
    const offered = new OfferedRecipes(2);
    offered.keep('run-1', 'a.recipe');
    offered.keep('run-2', 'b.recipe');
    offered.keep('run-3', 'c.recipe');

    expect(offered.take('run-1')).toBeUndefined();
    expect(offered.take('run-2')).toBe('b.recipe');
    expect(offered.take('run-2')).toBeUndefined();
    expect(offered.take('run-3')).toBe('c.recipe');
  });
});

describe('a refused line that came from an alias (TYTO-536)', () => {
  const { actions } = recorder();

  it('names the alias and where it is defined, in the sentence and in the box', async () => {
    const boxes: { readonly detail: string }[] = [];
    const settled = await settleRefusal(
      {
        message: TRUST_REFUSED,
        offer: TRUST,
        origin: { alias: 'entrega', definedIn: 'workspace' },
      },
      (box) => {
        boxes.push(box);
        return Promise.resolve(false);
      },
      actions,
      en,
    );
    expect(settled).toBe(
      `${TRUST_REFUSED} The line came from the alias 'entrega', defined in the workspace's ` +
        '.tyto/project.json (aliases).',
    );
    expect(
      boxes[0]?.detail.endsWith(
        "This line came from the alias 'entrega', defined in this workspace's .tyto/project.json (aliases).",
      ),
    ).toBe(true);
  });

  it('says a user alias is in the settings, with or without a box, in both languages', async () => {
    const origin = { alias: 'pub', definedIn: 'user' } as const;
    expect(await settleRefusal({ message: MCP_REFUSED, origin }, answer(true), actions, en)).toBe(
      `${MCP_REFUSED} The line came from the alias 'pub', defined in your settings (commandAliases).`,
    );
    expect(offerBox(WATCH, pt, origin).detail).toContain("seu apelido 'pub'");
  });
});
