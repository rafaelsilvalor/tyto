import { diagnostic, ok } from '@tyto/core';
import type { VimContribution } from '@tyto/editor';
import { describe, expect, it } from 'vitest';

import {
  type ApplyVimContributions,
  createWindowVimPlugins,
  enabledVimPlugins,
  vimContributionOf,
} from './vim-plugins.js';

const COMMENTARY: VimContribution = {
  id: 'commentary',
  mappings: [{ keys: 'gc', operation: 'comment' }],
};

/** An installed plugin's contribution: an id the setting's documentation does not know. */
const EXCHANGE: VimContribution = {
  id: 'exchange',
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
    expect(enabledVimPlugins([COMMENTARY, EXCHANGE], {})).toEqual(['commentary', 'exchange']);
  });

  it('switches off exactly the ids the setting names false', () => {
    expect(enabledVimPlugins([COMMENTARY, EXCHANGE], { commentary: false })).toEqual(['exchange']);
    expect(
      enabledVimPlugins([COMMENTARY, EXCHANGE], { exchange: false, commentary: true }),
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
    const refusal = diagnostic('E_VIM_CONTRIBUTION', { id: 'exchange', problem: 'no operation' });
    const reported: string[] = [];
    const window = createWindowVimPlugins(
      () => ok(['commentary'], [refusal]),
      (message) => reported.push(message),
    );

    window.contributionsArrived([COMMENTARY, EXCHANGE]);
    window.settingArrived({});
    window.settingArrived({});

    expect(reported).toEqual([refusal.message]);
  });
});
