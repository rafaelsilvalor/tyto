// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { EDITOR_SAVE } from '@tyto/editor';

import {
  BRIEF_ONLY_COMMANDS,
  EDITOR_GO_TO_BLOCK,
  EDITOR_FORMAT_BRIEF,
  FILE_EXPORT,
  PREVIEW_OPEN,
  PREVIEW_OPEN_TO_SIDE,
  PREVIEW_TOGGLE_LOCK,
  RECIPE_RUN,
  RECIPE_RUN_FRESH,
  RECIPE_RUN_FROM_CELL,
  SETTINGS_OPEN,
  TEMPLATE_EDIT,
  TEXT_COMMANDS,
  presetCommandId,
} from './commands.js';
import {
  assistOf,
  commandOffered,
  editorChromeFor,
  languageOf,
  slashTemplateChoiceFor,
  slashTemplateNote,
  templateChoiceFor,
  templateEditFor,
} from './editor-chrome.js';
import { type TemplateEdit } from './frontmatter.js';

describe('editorChromeFor (TYTO-256)', () => {
  it('keeps every brief control on a brief', () => {
    expect(editorChromeFor(undefined)).toEqual({
      templateEdits: true,
      briefCommands: true,
      textCommands: true,
    });
  });

  it("drops the brief's controls on an app file", () => {
    for (const kind of ['settings', 'keybindings', 'snippets'] as const) {
      expect(editorChromeFor(kind)).toEqual({
        templateEdits: false,
        briefCommands: false,
        textCommands: true,
      });
    }
  });

  it("keeps a brief's commands on its preview and drops the ones that act on text (TYTO-287)", () => {
    expect(editorChromeFor('preview')).toEqual({
      templateEdits: false,
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

  it('gives a tab the help of its own kind, and a brief or a preview none (TYTO-304)', () => {
    const help = [] as const;
    const assists = { settings: help };
    expect(assistOf('settings', assists)).toEqual([help]);
    expect(assistOf('keybindings', assists)).toEqual([]);
    expect(assistOf(undefined, assists)).toEqual([]);
    expect(assistOf('preview', assists)).toEqual([]);
  });
});

describe('a recipe tab (TYTO-377)', () => {
  it('is text with no brief control, and offers Run recipe where no other tab does', () => {
    expect(editorChromeFor('recipe')).toEqual({
      templateEdits: false,
      briefCommands: false,
      textCommands: true,
    });
    for (const id of BRIEF_ONLY_COMMANDS) expect(commandOffered('recipe', id), id).toBe(false);
    for (const id of [RECIPE_RUN, RECIPE_RUN_FROM_CELL, RECIPE_RUN_FRESH]) {
      expect(commandOffered('recipe', id), id).toBe(true);
      for (const kind of [undefined, 'text', 'markdown', 'settings', 'preview'] as const) {
        expect(commandOffered(kind, id), `${id} ${String(kind)}`).toBe(false);
      }
    }
  });

  it('opens in the recipe language with its own help', () => {
    const completion = [] as const;
    expect(languageOf('recipe')).toBe('recipe');
    expect(assistOf('recipe', { recipe: completion })).toEqual([completion]);
    expect(assistOf('text', { recipe: completion })).toEqual([]);
  });
});

describe('a text tab (TYTO-247, ADR 0132)', () => {
  it("drops the brief's controls on a .txt and a .md and keeps the text commands", () => {
    for (const kind of ['text', 'markdown'] as const) {
      expect(editorChromeFor(kind)).toEqual({
        templateEdits: false,
        briefCommands: false,
        textCommands: true,
      });
    }
  });

  it('offers no export, preset, zoom, format or slide, and every text command', () => {
    const markdownPreview = new Set([PREVIEW_OPEN_TO_SIDE, PREVIEW_OPEN, PREVIEW_TOGGLE_LOCK]);
    for (const kind of ['text', 'markdown'] as const) {
      for (const id of BRIEF_ONLY_COMMANDS) {
        const own = kind === 'markdown' && markdownPreview.has(id);
        expect(commandOffered(kind, id), id).toBe(own);
      }
      expect(commandOffered(kind, presetCommandId('Instagram'))).toBe(false);
      for (const id of TEXT_COMMANDS) {
        expect(commandOffered(kind, id), id).toBe(!BRIEF_ONLY_COMMANDS.has(id));
      }
      expect(commandOffered(kind, EDITOR_SAVE)).toBe(true);
      expect(commandOffered(kind, EDITOR_FORMAT_BRIEF)).toBe(false);
    }
  });

  it('offers a preview beside a .md and not beside a .txt', () => {
    for (const id of [PREVIEW_OPEN_TO_SIDE, PREVIEW_OPEN, PREVIEW_TOGGLE_LOCK]) {
      expect(commandOffered('markdown', id), id).toBe(true);
      expect(commandOffered('markdown-preview', id), id).toBe(true);
      expect(commandOffered('text', id), id).toBe(false);
    }
  });

  it("gives a Markdown file's preview neither a brief's commands nor the text commands", () => {
    expect(commandOffered('markdown-preview', FILE_EXPORT)).toBe(false);
    expect(commandOffered('markdown-preview', presetCommandId('Instagram'))).toBe(false);
    for (const id of TEXT_COMMANDS) expect(commandOffered('markdown-preview', id), id).toBe(false);
    expect(commandOffered('markdown-preview', EDITOR_SAVE)).toBe(true);
  });

  it('opens a .txt in plain text and a .md in Markdown, with no app-file help or template edit', () => {
    expect(languageOf('text')).toBe('plain');
    expect(languageOf('markdown')).toBe('markdown');
    expect(languageOf('markdown-preview')).toBeUndefined();
    expect(assistOf('markdown', { settings: [] as const })).toEqual([]);
    expect(templateEditFor('markdown', '# Notas', 'promo-curso')).toBeUndefined();
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

  it('offers Format Brief only with a brief’s text in front (TYTO-297)', () => {
    expect(commandOffered(undefined, EDITOR_FORMAT_BRIEF)).toBe(true);
    for (const kind of ['settings', 'keybindings', 'snippets', 'preview'] as const) {
      expect(commandOffered(kind, EDITOR_FORMAT_BRIEF), kind).toBe(false);
    }
  });

  it('offers Go to Block only with a brief’s text in front (TYTO-296)', () => {
    expect(commandOffered(undefined, EDITOR_GO_TO_BLOCK)).toBe(true);
    for (const kind of ['settings', 'keybindings', 'snippets', 'preview'] as const) {
      expect(commandOffered(kind, EDITOR_GO_TO_BLOCK), kind).toBe(false);
    }
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
