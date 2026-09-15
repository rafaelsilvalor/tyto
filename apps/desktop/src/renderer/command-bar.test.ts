// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  type CommandBar,
  type CommandEntry,
  COMMAND_BAR_TAG,
  filterCommands,
} from './command-bar.js';

/**
 * The command bar, driven through the element (E9.12).
 *
 * jsdom lays nothing out, so how the overlay *looks* is the end-to-end suite's question and
 * not this file's. What is here is everything a person does with a keyboard, which is all of
 * what a palette is: type, arrow, Enter, Escape — and the two things that are easy to get
 * wrong and invisible when they are, that focus lands in the input on open and goes back
 * where it came from on close.
 *
 * `await bar.updateComplete` before every read, the habit every Lit element needs (ADR 0024).
 */

const ENTRIES: readonly CommandEntry[] = [
  { id: 'editor.undo', label: 'Desfazer', binding: 'Ctrl+z' },
  { id: 'preview.zoomIn', label: 'Prévia: aumentar' },
  { id: 'preview.zoomFit', label: 'Prévia: ajustar à janela' },
  { id: 'shell.toggleLocale', label: 'Trocar o idioma da janela' },
];

function mount(): { bar: CommandBar; ran: string[] } {
  const bar = globalThis.document.createElement(COMMAND_BAR_TAG);
  const ran: string[] = [];
  bar.commands = ENTRIES;
  bar.locale = 'pt-BR';
  bar.run = (id) => ran.push(id);
  globalThis.document.body.append(bar);
  return { bar, ran };
}

const labels = (bar: CommandBar): string[] =>
  [...bar.querySelectorAll('.command-bar__label')].map((node) => node.textContent ?? '');

const type = async (bar: CommandBar, value: string): Promise<void> => {
  const input = bar.querySelector<HTMLInputElement>('.command-bar__input');
  if (input === null) throw new Error('no input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await bar.updateComplete;
};

const press = async (bar: CommandBar, key: string): Promise<void> => {
  bar
    .querySelector('.command-bar__panel')
    ?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  await bar.updateComplete;
};

describe('filtering', () => {
  it('matches without the accent a person did not type', () => {
    // "Prévia" is two keystrokes away on a Portuguese keyboard and nobody types it here.
    expect(filterCommands(ENTRIES, 'previa').map((entry) => entry.id)).toEqual([
      'preview.zoomIn',
      'preview.zoomFit',
    ]);
  });

  it('matches the id as well as the label, so either language finds it', () => {
    // The id is folded too, so the casing nobody remembers does not matter: `zoomfit`,
    // `zoomFit` and `ZoomFit` are one query. The label is Portuguese and the id is not,
    // which is what makes a command findable while the window is in the other language.
    for (const query of ['zoomfit', 'zoomFit', 'ZOOMFIT']) {
      expect(filterCommands(ENTRIES, query).map((entry) => entry.id)).toEqual(['preview.zoomFit']);
    }
    expect(filterCommands(ENTRIES, 'shell.')).toHaveLength(1);
  });

  it('shows everything for an empty query, including one that is only spaces', () => {
    expect(filterCommands(ENTRIES, '')).toHaveLength(4);
    expect(filterCommands(ENTRIES, '   ')).toHaveLength(4);
  });
});

describe('the bar a person types into', () => {
  it('renders nothing at all while it is closed', async () => {
    const { bar } = mount();
    await bar.updateComplete;

    expect(bar.querySelector('.command-bar__panel')).toBeNull();
    expect(bar.textContent).toBe('');
  });

  it('lists every command, with the key beside the ones that have one', async () => {
    const { bar } = mount();
    bar.show();
    await bar.updateComplete;

    expect(labels(bar)).toEqual([
      'Desfazer',
      'Prévia: aumentar',
      'Prévia: ajustar à janela',
      'Trocar o idioma da janela',
    ]);
    const keys = [...bar.querySelectorAll('.command-bar__key')].map((node) => node.textContent);
    expect(keys).toEqual(['Ctrl+z']);
  });

  it('puts the cursor in the input on open', async () => {
    const { bar } = mount();
    bar.show();
    await bar.updateComplete;

    expect(globalThis.document.activeElement).toBe(bar.querySelector('.command-bar__input'));
  });

  it('forgets what was typed last time', async () => {
    const { bar } = mount();
    bar.show();
    await bar.updateComplete;
    await type(bar, 'previa');
    expect(labels(bar)).toHaveLength(2);

    bar.dismiss();
    bar.show();
    await bar.updateComplete;

    expect(labels(bar)).toHaveLength(4);
    expect(bar.querySelector<HTMLInputElement>('.command-bar__input')?.value).toBe('');
  });

  it('runs the first match on Enter', async () => {
    const { bar, ran } = mount();
    bar.show();
    await bar.updateComplete;
    await type(bar, 'idioma');
    await press(bar, 'Enter');

    expect(ran).toEqual(['shell.toggleLocale']);
    expect(bar.open).toBe(false);
  });

  it('moves the selection with the arrows, and wraps at both ends', async () => {
    const { bar, ran } = mount();
    bar.show();
    await bar.updateComplete;

    await press(bar, 'ArrowUp');
    expect(bar.querySelector('.command-bar__option--on')?.textContent).toContain('idioma');

    await press(bar, 'ArrowDown');
    await press(bar, 'Enter');
    expect(ran).toEqual(['editor.undo']);
  });

  it('goes back to the top when the list changes under the selection', async () => {
    // A selection left pointing at row four of a list that just shrank to two is how a
    // palette runs a command nobody chose.
    const { bar, ran } = mount();
    bar.show();
    await bar.updateComplete;
    await press(bar, 'ArrowDown');
    await press(bar, 'ArrowDown');
    await type(bar, 'previa');
    await press(bar, 'Enter');

    expect(ran).toEqual(['preview.zoomIn']);
  });

  it('says so when nothing matches, and Enter does nothing', async () => {
    const { bar, ran } = mount();
    bar.show();
    await bar.updateComplete;
    await type(bar, 'exportar');

    expect(bar.querySelector('.command-bar__empty')?.textContent).toBe(
      'Nenhum comando com esse nome',
    );
    await press(bar, 'Enter');
    expect(ran).toEqual([]);
    expect(bar.open).toBe(true);
  });

  it('closes on Escape without running anything', async () => {
    const { bar, ran } = mount();
    bar.show();
    await bar.updateComplete;
    await press(bar, 'Escape');

    expect(bar.open).toBe(false);
    expect(ran).toEqual([]);
  });

  it('puts focus back where it came from', async () => {
    // The half a person notices: Escape from the bar has to leave the cursor in the editor,
    // not nowhere.
    const { bar } = mount();
    const before = globalThis.document.createElement('textarea');
    globalThis.document.body.append(before);
    before.focus();

    bar.show();
    await bar.updateComplete;
    expect(globalThis.document.activeElement).not.toBe(before);

    await press(bar, 'Escape');
    expect(globalThis.document.activeElement).toBe(before);
  });

  it('runs a command clicked with the mouse', async () => {
    const { bar, ran } = mount();
    bar.show();
    await bar.updateComplete;

    const option = [...bar.querySelectorAll('.command-bar__option')][2];
    option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(ran).toEqual(['preview.zoomFit']);
  });

  it('tells a screen reader which option is active', async () => {
    const { bar } = mount();
    bar.show();
    await bar.updateComplete;
    await press(bar, 'ArrowDown');

    const input = bar.querySelector('.command-bar__input');
    const active = input?.getAttribute('aria-activedescendant');
    expect(active).toBe('command-bar-option-1');
    expect(bar.querySelector(`#${String(active)}`)?.getAttribute('aria-selected')).toBe('true');
  });

  it('calls close once per dismissal, whichever way it was dismissed', async () => {
    const { bar } = mount();
    const closed = vi.fn();
    bar.close = closed;
    bar.show();
    await bar.updateComplete;
    await press(bar, 'Escape');

    expect(closed).toHaveBeenCalledOnce();
  });
});
