import { describe, expect, it } from 'vitest';

import { type VimSwitch, type WriteVimMode, createVimSetting } from './vim-setting.js';

/** The editor's vim switch, counting how often it was thrown. */
const switchAt = (enabled: boolean): VimSwitch & { readonly sets: boolean[] } => {
  const sets: boolean[] = [];
  let on = enabled;
  return {
    sets,
    isVimMode: () => on,
    setVimMode: (next) => {
      sets.push(next);
      on = next;
    },
  };
};

/** Main's side of `editor:vim-mode`: what it was asked, and the file taking every write. */
const fileTaking = (): WriteVimMode & { readonly asked: boolean[] } => {
  const asked: boolean[] = [];
  const write = (on: boolean) => {
    asked.push(on);
    return Promise.resolve({ vimMode: on, saved: true });
  };
  return Object.assign(write, { asked });
};

describe('the vimMode setting at start (TYTO-333)', () => {
  it('is off until main answers, which is the setting’s default', () => {
    expect(createVimSetting().current()).toBe(false);
  });

  it('turns vim on in an editor made after the answer', () => {
    const setting = createVimSetting();
    // The answer lands before the editor exists: nothing to move yet, and the editor is then
    // made with what `current` says.
    expect(setting.follow(true, undefined)).toBe(false);
    expect(setting.current()).toBe(true);
  });

  it('turns vim on in an editor made before the answer', () => {
    const setting = createVimSetting();
    const editor = switchAt(false);
    expect(setting.follow(true, editor)).toBe(true);
    expect(editor.isVimMode()).toBe(true);
  });

  it('leaves the editor alone when the answer says the default', () => {
    const setting = createVimSetting();
    const editor = switchAt(false);
    expect(setting.follow(false, editor)).toBe(false);
    expect(editor.sets).toEqual([]);
  });
});

describe('Editor: turn vim mode on or off (TYTO-333)', () => {
  it('flips the editor and writes the setting together', async () => {
    const setting = createVimSetting();
    const editor = switchAt(false);
    const write = fileTaking();

    await setting.toggle(editor, write);
    expect(editor.isVimMode()).toBe(true);
    expect(write.asked).toEqual([true]);
    expect(setting.current()).toBe(true);

    await setting.toggle(editor, write);
    expect(editor.isVimMode()).toBe(false);
    expect(write.asked).toEqual([true, false]);
    expect(setting.current()).toBe(false);
  });

  it('flips the editor before the write answers', async () => {
    const setting = createVimSetting();
    const editor = switchAt(false);
    let answer: (value: { vimMode: boolean; saved: boolean }) => void = () => {};
    const pending = setting.toggle(
      editor,
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    expect(editor.isVimMode()).toBe(true);
    answer({ vimMode: true, saved: true });
    await pending;
    expect(editor.isVimMode()).toBe(true);
  });

  it('goes back when the file refused the write', async () => {
    const setting = createVimSetting();
    const editor = switchAt(false);
    await setting.toggle(editor, () => Promise.resolve({ vimMode: false, saved: false }));
    expect(editor.isVimMode()).toBe(false);
    expect(setting.current()).toBe(false);
  });

  it('is not undone by a settings answer asked before the write landed', async () => {
    const setting = createVimSetting();
    const editor = switchAt(false);
    let answer: (value: { vimMode: boolean; saved: boolean }) => void = () => {};
    const pending = setting.toggle(
      editor,
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    // A theme answer asked earlier still carries the setting before the write.
    expect(setting.follow(false, editor)).toBe(false);
    expect(editor.isVimMode()).toBe(true);
    answer({ vimMode: true, saved: true });
    await pending;
    expect(editor.isVimMode()).toBe(true);
  });
});

describe('a hand edit of the setting (TYTO-333)', () => {
  it('turns vim on and off in place, as the saved file moves', () => {
    const setting = createVimSetting();
    const editor = switchAt(false);
    expect(setting.follow(true, editor)).toBe(true);
    expect(editor.isVimMode()).toBe(true);
    // Another answer with the same value is not a move.
    expect(setting.follow(true, editor)).toBe(false);
    expect(setting.follow(false, editor)).toBe(true);
    expect(editor.isVimMode()).toBe(false);
    expect(editor.sets).toEqual([true, false]);
  });

  it('wins over the command once the file says otherwise', async () => {
    const setting = createVimSetting();
    const editor = switchAt(false);
    await setting.toggle(editor, fileTaking());
    expect(editor.isVimMode()).toBe(true);
    expect(setting.follow(false, editor)).toBe(true);
    expect(editor.isVimMode()).toBe(false);
  });
});
