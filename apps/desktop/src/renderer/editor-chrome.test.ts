// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { BRIEF_ONLY_COMMANDS, FILE_EXPORT, SETTINGS_OPEN, TEMPLATE_EDIT } from './commands.js';
import {
  commandOffered,
  editorChromeFor,
  languageOf,
  paintEditorChrome,
  templateChoiceFor,
  templateEditFor,
} from './editor-chrome.js';
import { EDITOR_PANEL_TAG, PREVIEW_PANEL_TAG } from './panels.js';

describe('editorChromeFor (TYTO-256)', () => {
  it('keeps every brief control on a brief', () => {
    expect(editorChromeFor(undefined)).toEqual({
      heading: 'editor.heading',
      templatePicker: true,
      previewControls: true,
      previewNote: undefined,
      briefCommands: true,
    });
  });

  it("names an app file by the status bar's word and drops the brief's controls", () => {
    expect(editorChromeFor('settings')).toEqual({
      heading: 'status.kind.settings',
      templatePicker: false,
      previewControls: false,
      previewNote: 'preview.note.settings',
      briefCommands: false,
    });
    expect(editorChromeFor('keybindings')).toEqual({
      heading: 'status.kind.keybindings',
      templatePicker: false,
      previewControls: false,
      previewNote: 'preview.note.keybindings',
      briefCommands: false,
    });
  });

  it('opens a brief in its own language and an app file in another', () => {
    expect(languageOf(undefined)).toBeUndefined();
    expect(languageOf('settings')).toBe('json');
    expect(languageOf('keybindings')).toBe('json');
  });
});

describe('commandOffered (TYTO-283)', () => {
  it('offers every brief-only command with a brief in front', () => {
    for (const id of BRIEF_ONLY_COMMANDS) expect(commandOffered(undefined, id), id).toBe(true);
  });

  it('offers none of them with an app file in front', () => {
    for (const kind of ['settings', 'keybindings'] as const) {
      for (const id of BRIEF_ONLY_COMMANDS) expect(commandOffered(kind, id), id).toBe(false);
    }
  });

  it('leaves every other command alone, whatever is in front', () => {
    for (const kind of [undefined, 'settings', 'keybindings'] as const) {
      expect(commandOffered(kind, SETTINGS_OPEN)).toBe(true);
      // The template mode opens a folder, not the tab in front.
      expect(commandOffered(kind, TEMPLATE_EDIT)).toBe(true);
      expect(commandOffered(kind, 'a.plugin:command')).toBe(true);
    }
    expect(BRIEF_ONLY_COMMANDS.has(FILE_EXPORT)).toBe(true);
  });
});

describe('templateEditFor', () => {
  const settings = '{\n  "theme": "dark"\n}\n';

  it('writes no YAML into an app file, whatever the picker says', () => {
    // The bug this guards: `planTemplateEdit` on a text with no frontmatter inserts one.
    expect(templateEditFor('settings', settings, 'promo-curso')).toBeUndefined();
    expect(templateEditFor('keybindings', '[]\n', 'promo-curso')).toBeUndefined();
  });

  it('still edits a brief', () => {
    expect(templateEditFor(undefined, 'Olá\n', 'promo-curso')).toEqual({
      from: 0,
      to: 0,
      insert: '---\ntemplate: promo-curso\n---\n',
    });
  });

  it('does nothing for the empty choice', () => {
    expect(templateEditFor(undefined, 'Olá\n', '')).toBeUndefined();
  });
});

describe('templateChoiceFor (TYTO-275)', () => {
  it('answers the skeleton on a brief with nothing in it', () => {
    expect(templateChoiceFor(undefined, '', 'agenda-semana')).toEqual({ kind: 'skeleton' });
    expect(templateChoiceFor(undefined, '  \n\n', 'agenda-semana')).toEqual({ kind: 'skeleton' });
  });

  it('answers the one-line edit on a brief that says something', () => {
    expect(templateChoiceFor(undefined, 'Olá\n', 'promo-curso')).toEqual({
      kind: 'edit',
      edit: { from: 0, to: 0, insert: '---\ntemplate: promo-curso\n---\n' },
    });
  });

  it('answers nothing on an app file, even an empty one', () => {
    expect(templateChoiceFor('settings', '', 'agenda-semana')).toBeUndefined();
    expect(templateChoiceFor('keybindings', '', 'agenda-semana')).toBeUndefined();
  });
});

describe('paintEditorChrome', () => {
  const mount = async (): Promise<HTMLElement> => {
    const root = document.createElement('div');
    root.append(
      document.createElement(EDITOR_PANEL_TAG),
      document.createElement(PREVIEW_PANEL_TAG),
    );
    document.body.replaceChildren(root);
    await Promise.all(
      [...root.children].map(
        (child) => (child as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete,
      ),
    );
    return root;
  };

  const hidden = (root: HTMLElement, selector: string): boolean | undefined =>
    root.querySelector<HTMLElement>(selector)?.hidden;

  it('hides the brief controls and shows the note on the settings tab', async () => {
    const root = await mount();
    paintEditorChrome(root, editorChromeFor('settings'));

    expect(root.querySelector('#editor-heading')?.getAttribute('data-i18n')).toBe(
      'status.kind.settings',
    );
    expect(hidden(root, '.work__template')).toBe(true);
    expect(hidden(root, '#format-tabs')).toBe(true);
    expect(hidden(root, '.preview__slide')).toBe(true);
    expect(hidden(root, '.preview__zoom')).toBe(true);
    expect(hidden(root, '#preview-empty')).toBe(true);
    expect(hidden(root, '[data-i18n="preview.note.settings"]')).toBe(false);
    expect(hidden(root, '[data-i18n="preview.note.keybindings"]')).toBe(true);
  });

  it('puts every brief control back on a brief', async () => {
    const root = await mount();
    paintEditorChrome(root, editorChromeFor('keybindings'));
    paintEditorChrome(root, editorChromeFor(undefined));

    expect(root.querySelector('#editor-heading')?.getAttribute('data-i18n')).toBe('editor.heading');
    expect(hidden(root, '.work__template')).toBe(false);
    expect(hidden(root, '#format-tabs')).toBe(false);
    expect(hidden(root, '.preview__zoom')).toBe(false);
    expect(root.querySelectorAll('[data-preview-note]:not([hidden])')).toHaveLength(0);
  });
});
