import { describe, expect, it } from 'vitest';

import { leafCommands } from './cli-page.js';
import { LOCALES } from './markdown.js';
import { REFERENCE_PAGES, referencePagePath } from './pages.js';
import { builtInSettingOutlines } from './settings-page.js';
import { shippedThemes } from './themes-page.js';
import { commandTitle, unansweredKeybindings, windowCommandIds } from './window-commands.js';

/**
 * The Reference pages are artefacts of the code, so they go stale silently. The file snapshot
 * is both halves: `pnpm docs:gen` runs this suite with `--update` to write them, and every
 * other run — `pnpm check`, CI — compares and fails on a page that no longer matches.
 */
describe.each(LOCALES)('the %s Reference pages', (locale) => {
  it.each(REFERENCE_PAGES.map((page) => [page.slug, page] as const))(
    '%s.md matches what the code renders today',
    async (_slug, page) => {
      await expect(
        page.render(locale),
        'a Reference page is out of date — run `pnpm docs:gen` and commit the result.',
      ).toMatchFileSnapshot(referencePagePath(locale, page.slug));
    },
  );
});

describe('what the pages are made from', () => {
  it('reads the window and the CLI with no document, no window and no browser', () => {
    // Importing the renderer's command table is allowed because it pulls in no DOM
    // (architecture.md, on `tools/docs-gen`). This suite runs in Vitest's plain `node`
    // environment; a module that reached for `document` at import would have thrown above.
    expect('document' in globalThis).toBe(false);
    expect('window' in globalThis).toBe(false);
  });

  it('leaves off exactly the keys whose command the window never registers', () => {
    // `@tyto/editor` binds `Mod-Enter` to `editor.render` in both input modes and the window
    // registers no such command, so the key does nothing. The page does not offer it. When the
    // window starts answering it — or the binding goes — this fails and the page gains the key.
    expect(unansweredKeybindings().map((binding) => `${binding.key} → ${binding.command}`)).toEqual(
      ['Mod-Enter → editor.render'],
    );
  });

  it('gives every command a title from the catalogue, in both languages', () => {
    for (const id of windowCommandIds()) {
      for (const locale of LOCALES) {
        expect(commandTitle(id, locale), `${id} has no ${locale} title`).not.toBe(id);
      }
    }
  });

  it('describes every setting, every command line option and argument', () => {
    for (const setting of builtInSettingOutlines()) {
      expect(setting.description, setting.key).not.toBe('');
    }
    for (const { path, command } of leafCommands()) {
      expect(command.description(), path).not.toBe('');
      for (const option of command.options) expect(option.description, option.flags).not.toBe('');
      for (const argument of command.registeredArguments) {
        expect(argument.description, argument.name()).not.toBe('');
      }
    }
  });

  it('lists every theme once', () => {
    const ids = shippedThemes().map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
