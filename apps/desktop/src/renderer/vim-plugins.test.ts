import { diagnostic, ok } from '@tyto/core';
import type { VimContribution } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import type { SystemClipboard } from '@tyto/editor';

import {
  type ApplyVimContributions,
  type VimEffectSwitches,
  applyVimEffects,
  createWindowVimPlugins,
  enabledVimPlugins,
  vimContributionOf,
} from './vim-plugins.js';

const COMMENTARY: VimContribution = {
  id: 'commentary',
  mappings: [{ keys: 'gc', operation: 'comment' }],
};

/** An installed plugin's contribution: an id the setting's documentation does not know. */
const INSTALLED: VimContribution = {
  id: 'an-installed-plugin',
  mappings: [{ keys: 'cx', operation: 'exchange' }],
};

/** The editor's side, recording each call's enabled ids. */
const recording = (): ApplyVimContributions & { readonly calls: string[][] } => {
  const calls: string[][] = [];
  const apply: ApplyVimContributions = (_contributions, enabled) => {
    calls.push([...enabled]);
    return ok([...enabled]);
  };
  return Object.assign(apply, { calls });
};

describe('the vimPlugins setting in the window (TYTO-418, ADR 0143)', () => {
  it('has every plugin on when the setting names none, built-in and installed', () => {
    expect(enabledVimPlugins([COMMENTARY, INSTALLED], {})).toEqual([
      'commentary',
      'an-installed-plugin',
    ]);
  });

  it('switches off exactly the ids the setting names false', () => {
    expect(enabledVimPlugins([COMMENTARY, INSTALLED], { commentary: false })).toEqual([
      'an-installed-plugin',
    ]);
    expect(
      enabledVimPlugins([COMMENTARY, INSTALLED], {
        'an-installed-plugin': false,
        commentary: true,
      }),
    ).toEqual(['commentary']);
  });

  it('applies nothing before the contributions arrive, then on every arrival', () => {
    const apply = recording();
    const window = createWindowVimPlugins(apply, () => undefined);

    window.settingArrived({ commentary: false });
    expect(apply.calls).toEqual([]);

    window.contributionsArrived([COMMENTARY]);
    window.settingArrived({});

    expect(apply.calls).toEqual([[], ['commentary']]);
  });

  it('hands the editor the contribution without the plugin that sent it', () => {
    expect(
      vimContributionOf({
        plugin: 'desktop',
        id: 'commentary',
        title: 'Commentary',
        mappings: [{ keys: 'gc', operation: 'comment' }],
      }),
    ).toEqual({
      id: 'commentary',
      title: 'Commentary',
      mappings: [{ keys: 'gc', operation: 'comment' }],
    });
  });

  it('reports a refusal once, not on every settings answer that repeats it', () => {
    const refusal = diagnostic('E_VIM_CONTRIBUTION', {
      id: 'an-installed-plugin',
      problem: 'no operation',
    });
    const reported: string[] = [];
    const window = createWindowVimPlugins(
      () => ok(['commentary'], [refusal]),
      (message) => reported.push(message),
    );

    window.contributionsArrived([COMMENTARY, INSTALLED]);
    window.settingArrived({});
    window.settingArrived({});

    expect(reported).toEqual([refusal.message]);
  });
});

const SNEAK: VimContribution = { id: 'sneak', mappings: [{ keys: 's', operation: 'sneak' }] };

describe('sneak starts off (TYTO-419, ADR 0143 A2 amendment)', () => {
  it('is off when the setting does not name it, and on only when it names it true', () => {
    expect(enabledVimPlugins([COMMENTARY, SNEAK], {})).toEqual(['commentary']);
    expect(enabledVimPlugins([COMMENTARY, SNEAK], { sneak: false })).toEqual(['commentary']);
    expect(enabledVimPlugins([COMMENTARY, SNEAK], { sneak: true })).toEqual([
      'commentary',
      'sneak',
    ]);
  });
});

/** The editor's two switches, recording what each was handed. Never the real clipboard. */
const switches = (): VimEffectSwitches & {
  readonly flash: boolean[];
  readonly clipboard: (SystemClipboard | undefined)[];
} => {
  const flash: boolean[] = [];
  const clipboard: (SystemClipboard | undefined)[] = [];
  return {
    flash,
    clipboard,
    setVimYankFlash: (on) => flash.push(on),
    setVimSystemClipboard: (port) => clipboard.push(port),
  };
};

const STUB_CLIPBOARD: SystemClipboard = {
  readText: () => Promise.resolve(''),
  writeText: () => Promise.resolve(),
};

describe('the ids that switch an editor effect (TYTO-419, TYTO-442)', () => {
  it('has the yank flash and the system clipboard on when the setting names neither', () => {
    const editor = switches();
    applyVimEffects({}, editor, STUB_CLIPBOARD);
    expect(editor.flash).toEqual([true]);
    expect(editor.clipboard).toEqual([STUB_CLIPBOARD]);
  });

  it('switches each off on its own id', () => {
    const editor = switches();
    applyVimEffects({ highlightedYank: false }, editor, STUB_CLIPBOARD);
    applyVimEffects({ systemClipboard: false }, editor, STUB_CLIPBOARD);
    expect(editor.flash).toEqual([false, true]);
    expect(editor.clipboard).toEqual([STUB_CLIPBOARD, undefined]);
  });
});
