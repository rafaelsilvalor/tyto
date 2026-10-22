import { describe, expect, it } from 'vitest';

import {
  type ExplorerListing,
  type ExplorerTree,
  EMPTY_TREE,
  foldersToRelist,
  moveFor,
  rowsOf,
  startCreating,
  startRenaming,
  stopEditing,
  withDraft,
  withEditError,
  withExpanded,
  withListing,
  withSelected,
} from './explorer-tree.js';

/**
 * The explorer's tree as a value (TYTO-279, ADR 0115): which rows a set of listings draws, what
 * a folder answered `gone` takes with it, which folders a change on disk lists again, and what
 * each key does.
 */

const listing = (
  entries: readonly [id: string, name: string, kind: 'folder' | 'brief' | 'file'][],
  more = 0,
): ExplorerListing => ({
  entries: entries.map(([id, name, kind]) => ({ id, name, kind })),
  more,
  gone: false,
});

const GONE: ExplorerListing = { entries: [], more: 0, gone: true };

/** `promo/` holding `slides/` (with `capa.brief` and `extra/`), `assets/` and `promo.brief`. */
function tree(): ExplorerTree {
  let value = withListing(
    EMPTY_TREE,
    null,
    listing([
      ['slides', 'slides', 'folder'],
      ['assets', 'assets', 'folder'],
      ['promo', 'promo.brief', 'brief'],
    ]),
  );
  value = withListing(
    value,
    'slides',
    listing([
      ['extra', 'extra', 'folder'],
      ['capa', 'capa.brief', 'brief'],
    ]),
  );
  value = withListing(value, 'extra', listing([['fundo', 'fundo.png', 'file']]));
  value = withExpanded(value, 'slides', true);
  return withExpanded(value, 'extra', true);
}

const names = (value: ExplorerTree): string[] =>
  rowsOf(value).map((row) =>
    row.type === 'entry'
      ? `${'  '.repeat(row.depth)}${row.entry.name}${row.renaming === true ? ' [renaming]' : ''}`
      : row.type === 'new'
        ? `${'  '.repeat(row.depth)}[new ${row.kind}]`
        : `+${String(row.count)}`,
  );

describe('the rows', () => {
  it('draws an open folder’s children under it, and a closed one’s not at all', () => {
    expect(names(tree())).toEqual([
      'slides',
      '  extra',
      '    fundo.png',
      '  capa.brief',
      'assets',
      'promo.brief',
    ]);
    expect(names(withExpanded(tree(), 'slides', false))).toEqual([
      'slides',
      'assets',
      'promo.brief',
    ]);
  });

  it('keeps what was open inside a closed folder, for when it opens again', () => {
    const reopened = withExpanded(withExpanded(tree(), 'slides', false), 'slides', true);

    expect(names(reopened)).toContain('    fundo.png');
  });

  it('ends a capped listing with the count of what it left out', () => {
    const capped = withListing(EMPTY_TREE, null, listing([['a', 'a.brief', 'brief']], 1999));

    expect(names(capped)).toEqual(['a.brief', '+1999']);
  });
});

describe('a folder that is gone', () => {
  it('drops the folder’s subtree, open folders inside it included', () => {
    const dropped = withListing(tree(), 'slides', GONE);

    expect(dropped.children.has('slides')).toBe(false);
    expect(dropped.children.has('extra')).toBe(false);
    expect(dropped.expanded.has('slides')).toBe(false);
    expect(dropped.expanded.has('extra')).toBe(false);
    expect(names(dropped)).toEqual(['slides', 'assets', 'promo.brief']);
  });

  it('moves a selection that was inside it onto the folder', () => {
    const dropped = withListing(withSelected(tree(), 'fundo'), 'slides', GONE);

    expect(dropped.selected).toBe('slides');
  });

  it('leaves the rest of the tree as it was', () => {
    const value = withExpanded(withListing(tree(), 'assets', listing([])), 'assets', true);
    const dropped = withListing(value, 'extra', GONE);

    expect(dropped.expanded.has('slides')).toBe(true);
    expect(dropped.expanded.has('assets')).toBe(true);
  });
});

describe('a change on disk', () => {
  it('lists again the root and each open folder on screen, and no other', () => {
    expect(foldersToRelist(tree())).toEqual([null, 'slides', 'extra']);
    // `extra` is still open, but inside a closed folder it is not on screen.
    expect(foldersToRelist(withExpanded(tree(), 'slides', false))).toEqual([null]);
  });
});

describe('the keys', () => {
  const at = (id: string): ExplorerTree => withSelected(tree(), id);

  it('moves down and up the rows on screen, and jumps to either end', () => {
    expect(moveFor(at('slides'), 'ArrowDown')).toEqual({ do: 'select', id: 'extra' });
    expect(moveFor(at('extra'), 'ArrowUp')).toEqual({ do: 'select', id: 'slides' });
    expect(moveFor(at('promo'), 'ArrowDown')).toEqual({ do: 'select', id: 'promo' });
    expect(moveFor(at('capa'), 'Home')).toEqual({ do: 'select', id: 'slides' });
    expect(moveFor(at('slides'), 'End')).toEqual({ do: 'select', id: 'promo' });
    expect(moveFor(tree(), 'ArrowDown')).toEqual({ do: 'select', id: 'slides' });
  });

  it('opens a folder with Right and goes into it, closes it with Left and goes up', () => {
    expect(moveFor(at('assets'), 'ArrowRight')).toEqual({ do: 'expand', id: 'assets', open: true });
    expect(moveFor(at('slides'), 'ArrowRight')).toEqual({ do: 'select', id: 'extra' });
    expect(moveFor(at('slides'), 'ArrowLeft')).toEqual({ do: 'expand', id: 'slides', open: false });
    expect(moveFor(at('capa'), 'ArrowLeft')).toEqual({ do: 'select', id: 'slides' });
    expect(moveFor(at('promo'), 'ArrowLeft')).toBeUndefined();
  });

  it('opens a brief with Enter, toggles a folder, and does nothing for any other file', () => {
    expect(moveFor(at('capa'), 'Enter')).toEqual({ do: 'open', id: 'capa' });
    expect(moveFor(at('slides'), ' ')).toEqual({ do: 'expand', id: 'slides', open: false });
    expect(moveFor(at('fundo'), 'Enter')).toBeUndefined();
    expect(moveFor(at('capa'), 'x')).toBeUndefined();
  });
});

/** TYTO-352, ADR 0121: the name field is tree state, kept apart from the listings. */
describe('the name field', () => {
  it('puts a new entry in the selected folder, the selected file’s folder, or the root', () => {
    const inFolder = startCreating(withSelected(tree(), 'extra'), 'file');
    expect(inFolder.editing).toMatchObject({ parentId: 'extra', kind: 'file', draft: '' });
    expect(names(inFolder).slice(0, 4)).toEqual([
      'slides',
      '  extra',
      '    [new file]',
      '    fundo.png',
    ]);

    expect(startCreating(withSelected(tree(), 'capa'), 'folder').editing).toMatchObject({
      parentId: 'slides',
    });
    expect(startCreating(tree(), 'file').editing).toMatchObject({ parentId: null });
    expect(names(startCreating(tree(), 'file'))[0]).toBe('[new file]');
    // A closed folder opens, so the field shows under it.
    const closed = startCreating(withSelected(tree(), 'assets'), 'file');
    expect(closed.expanded.has('assets')).toBe(true);
    // The panel's empty space names the root, whatever is selected.
    expect(startCreating(withSelected(tree(), 'extra'), 'file', null).editing).toMatchObject({
      parentId: null,
    });
  });

  it('survives a re-list with what was typed and the line under it', () => {
    let value = withEditError(withDraft(startRenaming(tree(), 'capa'), 'abertura'), 'taken');
    value = withListing(
      value,
      'slides',
      listing([
        ['extra', 'extra', 'folder'],
        ['nova', 'nova.brief', 'brief'],
        ['capa', 'capa.brief', 'brief'],
      ]),
    );
    value = withListing(value, null, tree().root!);

    expect(value.editing).toEqual({ renameId: 'capa', draft: 'abertura', error: 'taken' });
    expect(names(value)).toContain('  capa.brief [renaming]');

    const typing = withListing(
      withDraft(startCreating(withSelected(tree(), 'extra'), 'file'), 'novo'),
      'extra',
      listing([['outro', 'outro.png', 'file']]),
    );
    expect(typing.editing).toMatchObject({ parentId: 'extra', draft: 'novo' });
  });

  it('goes when its folder comes back gone, or the renamed entry vanished', () => {
    const creating = withListing(
      startCreating(withSelected(tree(), 'extra'), 'file'),
      'slides',
      GONE,
    );
    expect(creating.editing).toBeUndefined();

    const renaming = withListing(
      startRenaming(tree(), 'capa'),
      'slides',
      listing([['extra', 'extra', 'folder']]),
    );
    expect(renaming.editing).toBeUndefined();
  });

  it('starts with the name it has, and clears the refusal on the next key', () => {
    const value = startRenaming(tree(), 'promo');
    expect(value.editing).toEqual({ renameId: 'promo', draft: 'promo.brief' });
    expect(value.selected).toBe('promo');
    expect(withDraft(withEditError(value, 'no'), 'x').editing).toEqual({
      renameId: 'promo',
      draft: 'x',
    });
    expect(stopEditing(value).editing).toBeUndefined();
  });

  it('renames with F2 and asks to delete with Delete, on the selected row', () => {
    const selected = withSelected(tree(), 'capa');
    expect(moveFor(selected, 'F2')).toEqual({ do: 'rename', id: 'capa' });
    expect(moveFor(selected, 'Delete')).toEqual({ do: 'delete', id: 'capa' });
    expect(moveFor(tree(), 'F2')).toBeUndefined();
  });
});
