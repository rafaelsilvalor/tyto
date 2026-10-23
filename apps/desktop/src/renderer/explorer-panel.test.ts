// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ExplorerListing } from './explorer-tree.js';
import {
  type ExplorerPanel,
  type ExplorerSource,
  EXPLORER_PANEL_TAG,
  deleteQuestion,
} from './explorer-panel.js';

/**
 * The explorer panel (TYTO-279, ADR 0115) as jsdom can see it: what it asks main and when, what
 * a click and a key do, what a change on disk redraws, and that an answer for a folder that has
 * since closed is not drawn. Where it sits and how it looks is the e2e's and the real window's.
 */

type Disk = Record<string, ExplorerListing>;

const entries = (
  ...items: [id: string, name: string, kind: 'folder' | 'brief' | 'file'][]
): ExplorerListing => ({
  entries: items.map(([id, name, kind]) => ({ id, name, kind })),
  more: 0,
  gone: false,
});

const GONE: ExplorerListing = { entries: [], more: 0, gone: true };

/** A source that answers from `disk`, and records what was asked, opened and written. */
function source(disk: Disk) {
  const asked: (string | null)[] = [];
  const opened: string[] = [];
  const shown: string[] = [];
  const folders: number[] = [];
  const wrote: unknown[][] = [];
  const questions: string[] = [];
  const control = {
    confirmed: true,
    chosen: null as string | null,
    menus: [] as string[][],
    trash: 'ok' as 'ok' | 'trash-failed',
  };
  const value: ExplorerSource = {
    create: (parentId, name, kind) => {
      wrote.push(['create', parentId, name, kind]);
      if (name === 'promo.brief') return Promise.resolve({ ok: false, reason: 'exists' });
      const kindOf = kind === 'folder' ? 'folder' : name.endsWith('.brief') ? 'brief' : 'file';
      const entry = { id: `new-${name}`, name, kind: kindOf } as const;
      const folder = parentId ?? 'root';
      disk[folder] = { ...(disk[folder] ?? GONE), gone: false };
      disk[folder] = { ...disk[folder], entries: [entry, ...disk[folder].entries] };
      return Promise.resolve({ ok: true, entry, document: null, documentId: null });
    },
    rename: (entryId, name) => {
      wrote.push(['rename', entryId, name]);
      if (name === 'logo.png') return Promise.resolve({ ok: false, reason: 'exists' });
      for (const listing of Object.values(disk)) {
        const at = listing.entries.findIndex((each) => each.id === entryId);
        if (at !== -1) {
          const entries_ = [...listing.entries];
          entries_[at] = { ...entries_[at]!, name };
          Object.assign(listing, { entries: entries_ });
          return Promise.resolve({ ok: true, entry: entries_[at]!, moved: [] });
        }
      }
      return Promise.resolve({ ok: false, reason: 'gone' });
    },
    unsavedUnder: () => Promise.resolve(0),
    confirm: (question) => {
      questions.push(question.message);
      return Promise.resolve(control.confirmed);
    },
    remove: (entryId) => {
      wrote.push(['delete', entryId]);
      if (control.trash === 'trash-failed') {
        return Promise.resolve({ ok: false, reason: 'trash-failed' });
      }
      for (const listing of Object.values(disk)) {
        Object.assign(listing, { entries: listing.entries.filter((each) => each.id !== entryId) });
      }
      return Promise.resolve({ ok: true, released: [] });
    },
    menu: (_x, _y, items) => {
      control.menus.push(items.map((item) => item.label));
      return Promise.resolve(control.chosen);
    },
    list: (entryId) => {
      asked.push(entryId);
      return Promise.resolve(disk[entryId ?? 'root'] ?? GONE);
    },
    open: (entryId) => {
      opened.push(entryId);
    },
    show: (entryId) => {
      shown.push(entryId);
    },
    openFolder: () => {
      folders.push(1);
    },
  };
  return { value, asked, opened, shown, folders, wrote, questions, control };
}

const settle = async (element: ExplorerPanel): Promise<void> => {
  await vi.waitFor(async () => {
    await element.updateComplete;
    expect(element.isUpdatePending).toBe(false);
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
};

async function mount(disk: Disk, folderName: string | null = 'promo') {
  document.body.innerHTML = `<${EXPLORER_PANEL_TAG}></${EXPLORER_PANEL_TAG}>`;
  const element = document.querySelector<ExplorerPanel>(EXPLORER_PANEL_TAG)!;
  element.locale = 'en';
  const fake = source(disk);
  element.source = fake.value;
  element.folderName = folderName;
  element.reset();
  await settle(element);
  return { element, ...fake };
}

const rows = (element: ExplorerPanel): string[] =>
  [...element.querySelectorAll<HTMLElement>('.explorer__row, .explorer__more')].map((row) =>
    row.classList.contains('explorer__more')
      ? (row.textContent ?? '').trim()
      : `${'  '.repeat(Number(row.getAttribute('aria-level')) - 1)}${row.dataset.name ?? ''}`,
  );

const row = (element: ExplorerPanel, name: string): HTMLElement =>
  element.querySelector<HTMLElement>(`.explorer__row[data-name="${name}"]`)!;

const disk = (): Disk => ({
  root: entries(
    ['slides', 'slides', 'folder'],
    ['promo', 'promo.brief', 'brief'],
    ['logo', 'logo.png', 'file'],
  ),
  slides: entries(['capa', 'capa.brief', 'brief']),
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('the explorer panel', () => {
  it('lists the open folder, and a folder only when it is opened', async () => {
    const { element, asked } = await mount(disk());

    expect(rows(element)).toEqual(['slides', 'promo.brief', 'logo.png']);
    expect(asked).toEqual([null]);

    row(element, 'slides').click();
    await settle(element);

    expect(asked).toEqual([null, 'slides']);
    expect(rows(element)).toEqual(['slides', '  capa.brief', 'promo.brief', 'logo.png']);
    expect(row(element, 'slides').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens a brief on a click, shows an image (TYTO-366), and does nothing for any other file', async () => {
    const folder = disk();
    folder['root'] = entries(
      ['promo', 'promo.brief', 'brief'],
      ['logo', 'logo.png', 'file'],
      ['vetor', 'vetor.SVG', 'file'],
      ['notas', 'notas.txt', 'file'],
    );
    const { element, opened, shown } = await mount(folder);

    row(element, 'logo.png').click();
    row(element, 'notas.txt').click();
    row(element, 'vetor.SVG').click();
    row(element, 'promo.brief').click();
    await settle(element);

    expect(opened).toEqual(['promo']);
    expect(shown).toEqual(['logo', 'vetor']);
    expect(row(element, 'promo.brief').getAttribute('aria-selected')).toBe('true');
  });

  it('shows an image with Enter, and only selects one with an arrow (TYTO-366)', async () => {
    const { element, opened, shown } = await mount(disk());
    const tree = element.querySelector<HTMLElement>('.explorer__tree')!;
    const press = async (key: string): Promise<void> => {
      tree.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await settle(element);
    };

    // The first key selects the first row; the second goes to the last, the image.
    await press('End');
    await press('End');
    expect(shown).toEqual([]);
    await press('Enter');

    expect(shown).toEqual(['logo']);
    expect(opened).toEqual([]);
  });

  it('moves with the arrows and opens with Enter', async () => {
    const { element, opened } = await mount(disk());
    const tree = element.querySelector<HTMLElement>('.explorer__tree')!;
    const press = async (key: string): Promise<void> => {
      tree.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await settle(element);
    };

    await press('ArrowDown');
    await press('ArrowRight');
    await press('ArrowRight');
    await press('Enter');

    expect(opened).toEqual(['capa']);
  });

  it('shows what changed on disk in every open folder', async () => {
    const shared = disk();
    const { element } = await mount(shared);
    row(element, 'slides').click();
    await settle(element);

    shared.slides = entries(['capa', 'capa.brief', 'brief'], ['nova', 'nova.brief', 'brief']);
    element.refresh();
    await settle(element);

    expect(rows(element)).toContain('  nova.brief');
  });

  it('drops a folder deleted outside the app, with what was open inside it', async () => {
    const shared = disk();
    const { element } = await mount(shared);
    row(element, 'slides').click();
    await settle(element);

    shared.root = entries(['promo', 'promo.brief', 'brief'], ['logo', 'logo.png', 'file']);
    delete shared.slides;
    element.refresh();
    await settle(element);

    expect(rows(element)).toEqual(['promo.brief', 'logo.png']);
  });

  it('says what a capped folder left out', async () => {
    const { element } = await mount({
      root: { ...entries(['a', 'a.brief', 'brief']), more: 1999 },
    });

    expect(rows(element)).toEqual(['a.brief', '1999 more not shown']);
  });

  it('offers Open Folder while none is open, and asks main nothing', async () => {
    const { element, asked, folders } = await mount(disk(), null);

    expect(element.querySelector('.explorer__note')?.textContent).toBe('No folder open');
    element.querySelector<HTMLButtonElement>('.explorer__open-folder')!.click();

    expect(folders).toEqual([1]);
    expect(asked).toEqual([]);
  });

  it('does not draw an answer for the folder it listed before', async () => {
    const { element } = await mount(disk());
    let answerOld: (value: ExplorerListing) => void = () => undefined;
    let first = true;
    element.source = {
      ...element.source,
      // The old folder's root listing is slow; the new folder's answers at once.
      list: () => {
        if (!first) return Promise.resolve(entries(['other', 'other.brief', 'brief']));
        first = false;
        return new Promise((resolve) => {
          answerOld = resolve;
        });
      },
    };
    element.refresh();

    // Another folder opens while the old one's answer is still on its way.
    element.folderName = 'other';
    element.reset();
    await settle(element);
    answerOld(entries(['late', 'late.brief', 'brief']));
    await settle(element);

    expect(rows(element)).toEqual(['other.brief']);
  });
});

describe('file-type icons (TYTO-282, ADR 0116)', () => {
  const icons = (element: ExplorerPanel): Record<string, string | undefined> =>
    Object.fromEntries(
      [...element.querySelectorAll<HTMLElement>('.explorer__row')].map((each) => [
        each.dataset.name ?? '',
        each.dataset.icon,
      ]),
    );

  it("draws each row's icon from its name, its kind and main's place", async () => {
    const { element } = await mount({
      root: {
        entries: [
          { id: 'saida', name: 'saida', kind: 'folder', place: 'output' },
          { id: 'slides', name: 'slides', kind: 'folder' },
          { id: 'promo', name: 'promo.brief', kind: 'brief' },
          { id: 'logo', name: 'logo.png', kind: 'file' },
          { id: 'sheet', name: 'planilha.xlsx', kind: 'file' },
        ],
        more: 0,
        gone: false,
      },
      slides: entries(),
    });

    expect(icons(element)).toEqual({
      saida: 'folderOutput',
      slides: 'folder',
      'promo.brief': 'brief',
      'logo.png': 'image',
      'planilha.xlsx': 'file',
    });
    expect(row(element, 'logo.png').querySelector('.explorer__icon svg')).not.toBeNull();

    row(element, 'slides').click();
    await settle(element);

    expect(icons(element).slides).toBe('folderOpen');
  });
});

/** TYTO-352, ADR 0121: new, rename and delete from the explorer. */
describe('new, rename and delete', () => {
  const press = async (element: ExplorerPanel, key: string): Promise<void> => {
    const target =
      element.querySelector<HTMLElement>('.explorer__field') ??
      element.querySelector<HTMLElement>('.explorer__tree')!;
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await settle(element);
  };
  const field = (element: ExplorerPanel): HTMLInputElement | null =>
    element.querySelector<HTMLInputElement>('.explorer__field');
  const type = async (element: ExplorerPanel, text: string): Promise<void> => {
    const input = field(element)!;
    input.value = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await settle(element);
  };
  const select = async (element: ExplorerPanel, name: string): Promise<void> => {
    row(element, name).click();
    await settle(element);
  };

  it('renames with F2: the field holds the name, Enter writes it, and the row is selected', async () => {
    const { element, wrote } = await mount(disk());
    await select(element, 'promo.brief');

    await press(element, 'F2');
    expect(field(element)?.value).toBe('promo.brief');
    await type(element, 'abertura.brief');
    await press(element, 'Enter');

    expect(wrote).toEqual([['rename', 'promo', 'abertura.brief']]);
    expect(field(element)).toBeNull();
    expect(rows(element)).toEqual(['slides', 'abertura.brief', 'logo.png']);
    expect(row(element, 'abertura.brief').getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the field, its text and the line under it when the name is taken', async () => {
    const { element } = await mount(disk());
    await select(element, 'promo.brief');
    await press(element, 'F2');
    await type(element, 'logo.png');
    await press(element, 'Enter');

    expect(field(element)?.value).toBe('logo.png');
    expect(element.querySelector('.explorer__error')?.textContent).toBe(
      'A file or folder named “logo.png” already exists here.',
    );
    await press(element, 'Escape');
    expect(field(element)).toBeNull();
    expect(rows(element)).toContain('promo.brief');
  });

  it('keeps the field and what was typed through a re-list from the watcher', async () => {
    const shared = disk();
    const { element } = await mount(shared);
    element.startNew('file');
    await settle(element);
    await type(element, 'novo');

    shared.root = entries(
      ['slides', 'slides', 'folder'],
      ['nova', 'nova.brief', 'brief'],
      ['promo', 'promo.brief', 'brief'],
    );
    element.refresh();
    await settle(element);

    expect(field(element)?.value).toBe('novo');
    expect(rows(element)).toContain('nova.brief');
  });

  it('makes the entry on blur, as typed, in the folder selected', async () => {
    const { element, wrote } = await mount(disk());
    await select(element, 'slides');
    element.startNew('folder');
    await settle(element);
    await type(element, 'anexos');
    field(element)!.dispatchEvent(new FocusEvent('blur'));
    await settle(element);

    expect(wrote).toEqual([['create', 'slides', 'anexos', 'folder']]);
    expect(rows(element)).toContain('  anexos');
  });

  it('asks before Delete, and moves nothing when the answer is no', async () => {
    const { element, wrote, questions, control } = await mount(disk());
    await select(element, 'logo.png');

    control.confirmed = false;
    await press(element, 'Delete');
    expect(questions).toEqual(['Move “logo.png” to the Recycle Bin?']);
    expect(wrote).toEqual([]);

    control.confirmed = true;
    await press(element, 'Delete');
    expect(wrote).toEqual([['delete', 'logo']]);
    expect(rows(element)).toEqual(['slides', 'promo.brief']);
  });

  it('says under the row that the trash refused, and nothing was deleted', async () => {
    const { element, control } = await mount(disk());
    await select(element, 'logo.png');
    control.trash = 'trash-failed';
    await press(element, 'Delete');

    expect(element.querySelector('.explorer__error')?.textContent).toBe(
      "Couldn't move it to the Recycle Bin. Nothing was deleted.",
    );
    expect(rows(element)).toContain('logo.png');
  });

  it('offers four items on a row and the two New items on the empty space', async () => {
    const { element, control } = await mount(disk());
    control.chosen = 'explorer.menu.rename';
    row(element, 'logo.png').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await settle(element);

    expect(field(element)?.value).toBe('logo.png');
    await press(element, 'Escape');

    control.chosen = 'explorer.menu.newFile';
    element
      .querySelector('.explorer__body')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    await settle(element);

    expect(control.menus).toEqual([
      ['New File…', 'New Folder…', 'Rename…', 'Delete'],
      ['New File…', 'New Folder…'],
    ]);
    expect(rows(element)[0]).toBe('slides');
    expect(field(element)).not.toBeNull();
  });
});

describe('the header actions (TYTO-365)', () => {
  const nested = (): Disk => ({
    ...disk(),
    slides: entries(['parte', 'parte', 'folder'], ['capa', 'capa.brief', 'brief']),
    parte: entries(['fim', 'fim.brief', 'brief']),
  });
  const actions = (element: ExplorerPanel): HTMLButtonElement[] => [
    ...element.querySelectorAll<HTMLButtonElement>('.tool__actions button[data-action]'),
  ];
  const click = async (element: ExplorerPanel, action: string): Promise<void> => {
    element.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!.click();
    await settle(element);
  };
  const field = (element: ExplorerPanel): HTMLInputElement | null =>
    element.querySelector<HTMLInputElement>('.explorer__field');
  /** Where the open field sits: the row above it, and how deep it is drawn. */
  const fieldRow = (element: ExplorerPanel): string =>
    field(element)!.closest<HTMLElement>('li')!.getAttribute('style') ?? '';

  it('draws three buttons before the close button, with the approved words', async () => {
    const { element } = await mount(disk());
    const header = element.querySelector('.tool__actions')!;
    expect(actions(element).map((each) => [each.title, each.getAttribute('aria-label')])).toEqual([
      ['New File…', 'New File…'],
      ['New Folder…', 'New Folder…'],
      ['Collapse All', 'Collapse All'],
    ]);
    expect(header.lastElementChild?.classList.contains('panel__close')).toBe(true);

    element.locale = 'pt-BR';
    await settle(element);
    expect(actions(element).map((each) => each.title)).toEqual([
      'Novo arquivo…',
      'Nova pasta…',
      'Recolher tudo',
    ]);
  });

  it('draws none of them while no folder is open, or while main is asked', async () => {
    const { element } = await mount(disk(), null);
    expect(actions(element)).toEqual([]);
    element.folderName = undefined;
    await settle(element);
    expect(actions(element)).toEqual([]);
  });

  it('opens the New File field in the root with nothing selected', async () => {
    const { element, wrote } = await mount(disk());
    await click(element, 'explorer.newFile');

    expect(field(element)?.getAttribute('aria-label')).toBe('New File…');
    expect(fieldRow(element)).toContain('padding-inline-start: 4px');
    field(element)!.value = 'nota.txt';
    field(element)!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    field(element)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle(element);
    expect(wrote).toEqual([['create', null, 'nota.txt', 'file']]);
  });

  it("opens the New File field in a selected file's folder", async () => {
    const { element, wrote } = await mount(disk());
    row(element, 'slides').click();
    await settle(element);
    row(element, 'capa.brief').click();
    await settle(element);
    await click(element, 'explorer.newFile');

    expect(fieldRow(element)).toContain('padding-inline-start: 20px');
    field(element)!.value = 'fim.brief';
    field(element)!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    field(element)!.dispatchEvent(new FocusEvent('blur'));
    await settle(element);
    expect(wrote).toEqual([['create', 'slides', 'fim.brief', 'file']]);
  });

  it('opens the New Folder field inside a selected folder, opening it', async () => {
    const { element, wrote } = await mount(disk());
    row(element, 'slides').click();
    await settle(element);
    row(element, 'slides').click();
    await settle(element);
    expect(row(element, 'slides').getAttribute('aria-expanded')).toBe('false');
    await click(element, 'explorer.newFolder');

    expect(field(element)?.getAttribute('aria-label')).toBe('New Folder…');
    expect(row(element, 'slides').getAttribute('aria-expanded')).toBe('true');
    field(element)!.value = 'anexos';
    field(element)!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    field(element)!.dispatchEvent(new FocusEvent('blur'));
    await settle(element);
    expect(wrote).toEqual([['create', 'slides', 'anexos', 'folder']]);
  });

  it('closes every folder at every depth, and keeps the selection on screen', async () => {
    const { element } = await mount(nested());
    row(element, 'slides').click();
    await settle(element);
    row(element, 'parte').click();
    await settle(element);
    row(element, 'fim.brief').click();
    await settle(element);
    expect(rows(element)).toEqual([
      'slides',
      '  parte',
      '    fim.brief',
      '  capa.brief',
      'promo.brief',
      'logo.png',
    ]);

    await click(element, 'explorer.collapseAll');
    expect(rows(element)).toEqual(['slides', 'promo.brief', 'logo.png']);
    expect(element.querySelector('[aria-expanded="true"]')).toBeNull();
    expect(row(element, 'slides').getAttribute('aria-selected')).toBe('true');

    // Opening the top folder again shows the one under it closed too.
    row(element, 'slides').click();
    await settle(element);
    expect(rows(element)).toEqual(['slides', '  parte', '  capa.brief', 'promo.brief', 'logo.png']);
  });
});

describe('the delete question (TYTO-352)', () => {
  it('says Recycle Bin on Windows and Trash elsewhere in English, Lixeira in Portuguese', () => {
    const file = { name: 'capa.brief', kind: 'brief' } as const;
    expect(deleteQuestion('en', 'win32', file, 0)).toEqual({
      message: 'Move “capa.brief” to the Recycle Bin?',
      detail: 'You can restore it from there.',
      confirm: 'Move to Recycle Bin',
      cancel: 'Cancel',
    });
    expect(deleteQuestion('en', 'darwin', file, 0).confirm).toBe('Move to Trash');
    expect(deleteQuestion('en', 'linux', file, 0).message).toBe('Move “capa.brief” to the Trash?');
    expect(deleteQuestion('pt-BR', 'darwin', { name: 'slides', kind: 'folder' }, 1)).toEqual({
      message: 'Mover a pasta “slides” e tudo o que há nela para a Lixeira?',
      detail:
        'Dá para restaurar de lá.\n\n1 aba aberta tem alterações não salvas; o texto continua na aba.',
      confirm: 'Mover para a Lixeira',
      cancel: 'Cancelar',
    });
    expect(deleteQuestion('en', 'win32', file, 3).detail).toContain('3 open tabs have');
  });
});
