// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { EDITOR_SAVE } from '@tyto/editor';

import {
  BRIEF_ONLY_COMMANDS,
  FILE_EXPORT,
  PREVIEW_OPEN_TO_SIDE,
  SETTINGS_OPEN,
  TEMPLATE_EDIT,
  TEXT_COMMANDS,
} from './commands.js';
import {
  commandOffered,
  editorChromeFor,
  languageOf,
  paintEditorChrome,
  slashTemplateChoiceFor,
  slashTemplateNote,
  templateChoiceFor,
  templateEditFor,
} from './editor-chrome.js';
import { type TemplateEdit } from './frontmatter.js';
import { createTemplatePicker } from './panels.js';

describe('editorChromeFor (TYTO-256)', () => {
  it('keeps every brief control on a brief', () => {
    expect(editorChromeFor(undefined)).toEqual({
      templatePicker: true,
      briefCommands: true,
      textCommands: true,
    });
  });

  it("drops the brief's controls on an app file", () => {
    for (const kind of ['settings', 'keybindings', 'snippets'] as const) {
      expect(editorChromeFor(kind)).toEqual({
        templatePicker: false,
        briefCommands: false,
        textCommands: true,
      });
    }
  });

  it("keeps a brief's commands on its preview and drops the ones that act on text (TYTO-287)", () => {
    expect(editorChromeFor('preview')).toEqual({
      templatePicker: false,
      briefCommands: true,
      textCommands: false,
    });
  });

  it('opens a brief in its own language and an app file in another', () => {
    expect(languageOf(undefined)).toBeUndefined();
    expect(languageOf('settings')).toBe('json');
    expect(languageOf('keybindings')).toBe('json');
    expect(languageOf('snippets')).toBe('json');
  });
});

describe('commandOffered (TYTO-283)', () => {
  it('offers every brief-only command with a brief in front', () => {
    for (const id of BRIEF_ONLY_COMMANDS) expect(commandOffered(undefined, id), id).toBe(true);
  });

  it('offers none of them with an app file in front', () => {
    for (const kind of ['settings', 'keybindings', 'snippets'] as const) {
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

  it('offers a brief’s commands with its preview in front, and none that act on text', () => {
    // Export, the zoom and the lock act on the brief the preview shows; undo, find and the "/"
    // menu would act on the hidden pane of its group, which shows nothing (TYTO-287).
    for (const id of BRIEF_ONLY_COMMANDS) {
      expect(commandOffered('preview', id), id).toBe(!TEXT_COMMANDS.has(id));
    }
    for (const id of TEXT_COMMANDS) expect(commandOffered('preview', id), id).toBe(false);
    for (const id of TEXT_COMMANDS) expect(commandOffered(undefined, id), id).toBe(true);
    expect(commandOffered('preview', EDITOR_SAVE)).toBe(true);
    expect(commandOffered('preview', PREVIEW_OPEN_TO_SIDE)).toBe(true);
    expect(commandOffered('settings', PREVIEW_OPEN_TO_SIDE)).toBe(false);
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

describe('the "/" menu choosing a template (TYTO-276)', () => {
  /**
   * The changes applied to `text` the way one CodeMirror transaction applies them: every
   * position is in the original text, and an insertion at a deletion's start goes in front.
   */
  const applied = (text: string, changes: readonly TemplateEdit[]): string => {
    let result = '';
    let position = 0;
    const ordered = [...changes].sort(
      (left, right) => left.from - right.from || left.to - right.to,
    );
    for (const change of ordered) {
      result += text.slice(position, change.from) + change.insert;
      position = Math.max(position, change.to);
    }
    return result + text.slice(position);
  };

  it('answers the skeleton when the "/" and its query are all the brief holds', () => {
    expect(slashTemplateChoiceFor(undefined, '/agen', 0, 5, 'agenda-semana')).toEqual({
      kind: 'skeleton',
    });
    expect(slashTemplateNote('\n/agen', 1, 6, 'agenda-semana')).toEqual({
      key: 'slash.template.new',
    });
  });

  it('switches `template:` and takes the "/" away in one set of changes on a brief with content', () => {
    const brief = '---\ntemplate: promo-curso\n---\n\n::titulo Olá\n/tab';
    const from = brief.indexOf('/tab');
    const choice = slashTemplateChoiceFor(undefined, brief, from, brief.length, 'tabela-roxo');

    expect(choice?.kind).toBe('changes');
    if (choice?.kind !== 'changes') return;
    expect(applied(brief, choice.changes)).toBe(
      '---\ntemplate: tabela-roxo\n---\n\n::titulo Olá\n',
    );
    expect(slashTemplateNote(brief, from, brief.length, 'tabela-roxo')).toEqual({
      key: 'slash.template.switch',
      current: 'promo-curso',
    });
  });

  it('writes a frontmatter above a brief that has none, and still takes the "/"', () => {
    const brief = '/ban\n::titulo Olá\n';
    const choice = slashTemplateChoiceFor(undefined, brief, 0, 4, 'banner-roxo');
    if (choice?.kind !== 'changes')
      throw new Error(`expected changes, got ${String(choice?.kind)}`);
    expect(applied(brief, choice.changes)).toBe(
      '---\ntemplate: banner-roxo\n---\n\n::titulo Olá\n',
    );
    expect(slashTemplateNote(brief, 0, 4, 'banner-roxo')).toEqual({ key: 'slash.template.set' });
  });

  it('takes only the "/" when the brief already names that template', () => {
    const brief = '---\ntemplate: tabela-roxo\n---\n/tab';
    const choice = slashTemplateChoiceFor(undefined, brief, 30, 34, 'tabela-roxo');
    expect(choice).toEqual({ kind: 'changes', changes: [{ from: 30, to: 34, insert: '' }] });
    expect(slashTemplateNote(brief, 30, 34, 'tabela-roxo')).toEqual({
      key: 'slash.template.current',
    });
  });

  it('answers nothing on an app file', () => {
    expect(slashTemplateChoiceFor('settings', '/a', 0, 2, 'agenda-semana')).toBeUndefined();
  });
});

describe('paintEditorChrome', () => {
  // The one picker the focused group's header row holds (TYTO-288), made the way `main.ts`
  // makes it; out of the document, as it is before that group has rendered.
  it('hides the template picker on an app file', () => {
    const picker = createTemplatePicker(document);
    paintEditorChrome(picker, editorChromeFor('settings'));
    expect(picker.hidden).toBe(true);
    expect(picker.querySelector('select')?.id).toBe('template');
  });

  it('puts the picker back on a brief, and hides it with a preview in front', () => {
    const picker = createTemplatePicker(document);
    paintEditorChrome(picker, editorChromeFor('keybindings'));
    paintEditorChrome(picker, editorChromeFor(undefined));
    expect(picker.hidden).toBe(false);

    paintEditorChrome(picker, editorChromeFor('preview'));
    expect(picker.hidden).toBe(true);
  });
});
