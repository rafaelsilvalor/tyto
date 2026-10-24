/**
 * The `vimMode` setting on the window's side (TYTO-333): what a new editor starts in, what a
 * save of `settings.json` moves, and what "Editor: turn vim mode on or off" writes.
 *
 * The editor follows the setting **when the setting moves**, never on every answer that carries
 * it. `theme:current` is asked at many moments — the picker asks on every highlight — and an
 * answer asked before the command's write lands would otherwise turn vim back off for as long
 * as the next answer takes.
 */

/** The part of the editor the setting moves. */
export interface VimSwitch {
  isVimMode(): boolean;
  setVimMode(enabled: boolean): void;
}

/** Writes the setting through main: the setting in force after, and whether the file took it. */
export type WriteVimMode = (
  on: boolean,
) => Promise<{ readonly vimMode: boolean; readonly saved: boolean }>;

export interface VimSetting {
  /** The setting as main last answered it: what an editor made now starts in. */
  current(): boolean;
  /**
   * A settings answer arrived. When the setting moved since the last one, the editor goes to
   * it. Answers whether the editor changed, so the caller knows to repaint.
   */
  follow(setting: boolean, editor: VimSwitch | undefined): boolean;
  /**
   * The command: the editor flips at once, the setting is written, and the editor ends where
   * main's answer says the setting is — back where it was when the file refused the write.
   */
  toggle(editor: VimSwitch, write: WriteVimMode | undefined): Promise<void>;
}

export function createVimSetting(initial = false): VimSetting {
  let setting = initial;
  const goTo = (editor: VimSwitch, enabled: boolean): boolean => {
    if (editor.isVimMode() === enabled) return false;
    editor.setVimMode(enabled);
    return true;
  };
  return {
    current: () => setting,
    follow(next, editor) {
      const moved = next !== setting;
      setting = next;
      if (!moved || editor === undefined) return false;
      return goTo(editor, next);
    },
    async toggle(editor, write) {
      const wanted = !editor.isVimMode();
      editor.setVimMode(wanted);
      if (write === undefined) return;
      // `setting` moves only on the answer: a settings answer that lands while the write is on
      // its way still carries the old value, and must not read as the setting moving back.
      const answer = await write(wanted);
      setting = answer.vimMode;
      goTo(editor, answer.vimMode);
    },
  };
}
