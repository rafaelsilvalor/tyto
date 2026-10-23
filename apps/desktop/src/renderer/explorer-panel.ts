import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';

import {
  type ExplorerEntry,
  type ExplorerListing,
  type ExplorerRow,
  type ExplorerTree,
  EMPTY_TREE,
  collapseAll,
  foldersToRelist,
  isMenuKey,
  moveFor,
  parentOf,
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
import { fileIconFor, isPreviewImage } from '../../shared/file-icons.js';
import { type CatalogueKey, type Locale, translate } from '../../shared/i18n/index.js';
import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';
import { type IconName, icon } from './icons.js';
import { DockedPanel } from './panels.js';

/**
 * The explorer (TYTO-279, ADR 0115): the files of the open workspace folder, in the left area
 * above the queue, as Rafael placed it on 2026-10-21.
 *
 * **It holds no path and asks main for everything.** A folder's children come from
 * `explorer:list` by the id main gave the folder; a brief opens through `explorer:open` by its
 * id. Any other file is shown and does nothing when clicked: nothing in a folder is handed to
 * the system (ADR 0111). A folder is listed when it is first opened, and every open one again
 * when main says the folder changed on disk.
 *
 * **New, rename and delete** (TYTO-352, ADR 0121) come from the system's context menu, from F2
 * and from Delete. A name is typed in a field in the tree: Enter or leaving the field confirms
 * it, Escape cancels it, and a name main refuses keeps the field open with a line under it.
 * A delete always asks first, in main's dialog, and goes to the system's trash. The tool header
 * has New File and New Folder too, beside Collapse All (TYTO-365), and Shift+F10 or the
 * ContextMenu key opens the context menu under the selected row (TYTO-364).
 *
 * The tree is a value (`explorer-tree.ts`); this element draws it and turns clicks and keys into
 * the next value. It lives as long as the dock keeps it: closing the panel forgets which folders
 * were open, as closing the queue forgets its scroll.
 */

export const EXPLORER_PANEL_TAG = 'tyto-explorer-panel';

type MenuItems = IpcRequest<'menu:context'>['items'];

/** What the panel asks of the window. `main.ts` wires each to the bridge. */
export interface ExplorerSource {
  readonly list: (entryId: string | null) => Promise<ExplorerListing>;
  readonly open: (entryId: string) => void;
  /** An image shown in the following preview, the focus left in the tree (TYTO-366). */
  readonly show: (entryId: string) => void;
  /** File ▸ Open Folder, offered while no folder is open. */
  readonly openFolder: () => void;
  /** A new entry; a new brief opens in a tab on the window's side. */
  readonly create: (
    parentId: string | null,
    name: string,
    kind: 'file' | 'folder',
  ) => Promise<IpcResponse<'explorer:create'>>;
  /** A rename; the window renames the tabs it moved. */
  readonly rename: (entryId: string, name: string) => Promise<IpcResponse<'explorer:rename'>>;
  /** How many tabs with unsaved text hold a file at or under the entry. */
  readonly unsavedUnder: (entryId: string) => Promise<number>;
  /** Main's yes-or-no dialog, `dialog:confirm`. */
  readonly confirm: (question: IpcRequest<'dialog:confirm'>) => Promise<boolean>;
  /** The move to the trash; the window lets go of the tabs it released. */
  readonly remove: (entryId: string) => Promise<IpcResponse<'explorer:delete'>>;
  /** The system's context menu at a point, answering the id picked or `null`. */
  readonly menu: (x: number, y: number, items: MenuItems) => Promise<string | null>;
}

const refused = { ok: false, reason: 'gone' } as const;

const idle: ExplorerSource = {
  list: () => Promise.resolve({ entries: [], more: 0, gone: true }),
  open: () => undefined,
  show: () => undefined,
  openFolder: () => undefined,
  create: () => Promise.resolve(refused),
  rename: () => Promise.resolve(refused),
  unsavedUnder: () => Promise.resolve(0),
  confirm: () => Promise.resolve(false),
  remove: () => Promise.resolve(refused),
  menu: () => Promise.resolve(null),
};

/** Pixels each level indents, the width of a chevron, so a file lines up under its folder's. */
const INDENT = 16;

/** The context menu's items, by id. */
export const EXPLORER_MENU = {
  newFile: 'explorer.menu.newFile',
  newFolder: 'explorer.menu.newFolder',
  rename: 'explorer.menu.rename',
  delete: 'explorer.menu.delete',
} as const satisfies Record<string, CatalogueKey>;

type MenuId = (typeof EXPLORER_MENU)[keyof typeof EXPLORER_MENU];

const fill = (text: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce(
    (filled, [key, value]) => filled.replaceAll(`{${key}}`, String(value)),
    text,
  );

/**
 * The system's trash, by its name on the platform: the Recycle Bin on Windows and the Trash
 * on macOS and Linux in English; *Lixeira* on all three in Portuguese.
 */
export function binOf(locale: Locale, platform: string): string {
  const other = platform === 'darwin' || platform === 'linux';
  return translate(locale, other ? 'explorer.bin.other' : 'explorer.bin.windows');
}

/** The question before a delete, in the words Rafael approved on TYTO-352. */
export function deleteQuestion(
  locale: Locale,
  platform: string,
  entry: Pick<ExplorerEntry, 'name' | 'kind'>,
  unsaved: number,
): IpcRequest<'dialog:confirm'> {
  const bin = binOf(locale, platform);
  const say = (key: CatalogueKey): string =>
    fill(translate(locale, key), { name: entry.name, bin, count: unsaved });
  const restore = say('explorer.delete.detail');
  const tabs =
    unsaved === 0
      ? undefined
      : say(unsaved === 1 ? 'explorer.delete.unsaved.one' : 'explorer.delete.unsaved.many');
  return {
    message: say(entry.kind === 'folder' ? 'explorer.delete.folder' : 'explorer.delete.file'),
    detail: tabs === undefined ? restore : `${restore}\n\n${tabs}`,
    confirm: say('explorer.delete.confirm'),
    cancel: say('explorer.delete.cancel'),
  };
}

/** `gone` has no line: the field just closes, as what it was about has gone. */
const REFUSALS: Partial<Record<string, CatalogueKey>> = {
  exists: 'explorer.error.exists',
  invalid: 'explorer.error.invalid',
  'trash-failed': 'explorer.error.trash',
  failed: 'explorer.error.failed',
};

/** The line under the field, or under a row whose delete failed, for what main answered. */
export function refusalText(
  locale: Locale,
  platform: string,
  name: string,
  failure: { readonly reason: string; readonly detail?: string | undefined },
): string | undefined {
  const values = { name, bin: binOf(locale, platform), reason: failure.detail ?? '' };
  const key = REFUSALS[failure.reason];
  return key === undefined ? undefined : fill(translate(locale, key), values);
}

export class ExplorerPanel extends DockedPanel {
  static override properties = {
    ...DockedPanel.properties,
    folderName: { attribute: false },
    source: { attribute: false },
    platform: { attribute: false },
    tree: { state: true },
    notice: { state: true },
  };

  /** The open folder's name, `null` with none open, nothing while main is asked. */
  declare folderName: string | null | undefined;
  declare source: ExplorerSource;
  /** `process.platform`, for what the trash is called. */
  declare platform: string;
  declare tree: ExplorerTree;
  /** A delete the trash refused: the line under that row, until the next act. */
  declare notice: { readonly id: string; readonly text: string } | undefined;

  /** Bumped by `reset`, so an answer for a folder that has since closed is not drawn. */
  private generation = 0;
  /** A name on its way to main: Enter and the blur that follows it confirm once. */
  private committing = false;
  /** The row the tree moves the focus to on the next draw, after the field closed. */
  private focusSelected = false;
  /**
   * A context menu is on screen. Chromium follows the ContextMenu key with a `contextmenu`
   * event of its own (the e2e measured a second menu with neither this nor `onKeyUp`); either
   * one alone keeps that from asking twice, and both are kept.
   */
  private menuOpen = false;

  constructor() {
    super();
    this.folderName = undefined;
    this.source = idle;
    this.platform = '';
    this.tree = EMPTY_TREE;
    this.notice = undefined;
  }

  /** Forgets the tree and lists the open folder from the top: another folder was opened. */
  reset(): void {
    this.generation += 1;
    this.tree = EMPTY_TREE;
    this.notice = undefined;
    if (this.folderName !== null && this.folderName !== undefined) void this.relist([null]);
  }

  /** Lists again every open folder on screen: main heard a change on disk. */
  refresh(): void {
    if (this.folderName === null || this.folderName === undefined) return;
    void this.relist(foldersToRelist(this.tree));
  }

  /** The field of a new file or folder, where `startCreating` puts it. */
  startNew(kind: 'file' | 'folder', parent?: string | null): void {
    if (this.folderName === null || this.folderName === undefined) return;
    this.notice = undefined;
    this.tree = startCreating(this.tree, kind, parent);
    const editing = this.tree.editing;
    const folder = editing !== undefined && 'parentId' in editing ? editing.parentId : null;
    if (folder !== null && !this.tree.children.has(folder)) void this.relist([folder]);
  }

  private async relist(folders: readonly (string | null)[]): Promise<void> {
    const mine = this.generation;
    const answers = await Promise.all(
      folders.map(async (folder) => {
        try {
          return { folder, listing: await this.source.list(folder) };
        } catch {
          return undefined;
        }
      }),
    );
    if (mine !== this.generation) return;
    let tree = this.tree;
    for (const answer of answers) {
      if (answer !== undefined) tree = withListing(tree, answer.folder, answer.listing);
    }
    this.tree = tree;
  }

  private toggle(id: string, open: boolean): void {
    this.tree = withExpanded(withSelected(this.tree, id), id, open);
    if (open && !this.tree.children.has(id)) void this.relist([id]);
  }

  private activate(row: ExplorerRow & { type: 'entry' }): void {
    const { entry } = row;
    this.notice = undefined;
    if (entry.kind === 'folder') {
      this.toggle(entry.id, !row.expanded);
      return;
    }
    this.tree = withSelected(this.tree, entry.id);
    this.openEntry(entry);
  }

  /**
   * A brief opens in a tab; an image shows in the preview, and the focus stays here so the
   * arrows go on choosing (TYTO-366, ADR 0124). Any other file does nothing.
   */
  private openEntry(entry: ExplorerEntry): void {
    if (entry.kind === 'brief') this.source.open(entry.id);
    else if (entry.kind === 'file' && isPreviewImage(entry.name)) this.source.show(entry.id);
  }

  private onKey(event: KeyboardEvent): void {
    // The field's keys are the field's: an arrow moves the caret, not the selection.
    if (event.target instanceof HTMLInputElement) return;
    const move = moveFor(this.tree, event.key, event.shiftKey);
    if (move === undefined) return;
    event.preventDefault();
    if (move.do === 'menu') void this.menuFromKey(move.id, event.target);
    else if (move.do === 'select') this.tree = withSelected(this.tree, move.id);
    else if (move.do === 'expand') this.toggle(move.id, move.open);
    else if (move.do === 'rename') this.tree = startRenaming(this.tree, move.id);
    else if (move.do === 'delete') void this.trashEntry(move.id);
    else {
      const entry = this.entryOf(move.id);
      if (entry !== undefined) this.openEntry(entry);
    }
  }

  private entryOf(id: string): ExplorerEntry | undefined {
    for (const row of rowsOf(this.tree)) {
      if (row.type === 'entry' && row.entry.id === id) return row.entry;
    }
    return undefined;
  }

  /** Asks first, always, and only then moves the entry to the trash (ADR 0121). */
  private async trashEntry(id: string): Promise<void> {
    const entry = this.entryOf(id);
    if (entry === undefined) return;
    this.notice = undefined;
    const folder = parentOf(this.tree, id) ?? null;
    const unsaved = await this.source.unsavedUnder(id);
    const question = deleteQuestion(this.locale, this.platform, entry, unsaved);
    if (!(await this.source.confirm(question))) return;
    const answer = await this.source.remove(id);
    if (!answer.ok && answer.reason === 'trash-failed') {
      this.notice = {
        id,
        text: refusalText(this.locale, this.platform, entry.name, answer) ?? '',
      };
      return;
    }
    if (this.tree.selected === id) this.tree = withSelected(this.tree, folder ?? undefined);
    await this.relist([folder]);
  }

  /** Enter, or leaving the field: main writes the name, or says why it will not. */
  private async commit(): Promise<void> {
    const editing = this.tree.editing;
    if (editing === undefined || this.committing) return;
    const name = editing.draft;
    const renamed = 'renameId' in editing ? this.entryOf(editing.renameId) : undefined;
    // Nothing typed, or the name it had: nothing to write, as VS Code does.
    if (name === '' || (renamed !== undefined && renamed.name === name)) {
      this.cancel();
      return;
    }
    const folder =
      'parentId' in editing ? editing.parentId : (parentOf(this.tree, editing.renameId) ?? null);
    const mine = this.generation;
    this.committing = true;
    try {
      const answer =
        'parentId' in editing
          ? await this.source.create(folder, name, editing.kind)
          : await this.source.rename(editing.renameId, name);
      if (mine !== this.generation || this.tree.editing === undefined) return;
      if (answer.ok) {
        // Listed at once and selected by the id main gave it; the watcher's re-list later
        // finds the same id, so nothing moves twice.
        this.tree = withSelected(stopEditing(this.tree), answer.entry.id);
        // A new brief opened in a tab, which has the focus now; otherwise the row takes it.
        this.focusSelected = !('document' in answer && answer.document !== null);
        await this.relist([folder]);
        return;
      }
      const text = refusalText(this.locale, this.platform, name, answer);
      if (text === undefined) {
        // Gone: the folder or the entry went while the name was typed.
        this.tree = stopEditing(this.tree);
        this.refresh();
        return;
      }
      this.tree = withEditError(this.tree, text);
    } finally {
      this.committing = false;
    }
  }

  private cancel(): void {
    if (this.tree.editing === undefined) return;
    this.tree = stopEditing(this.tree);
    this.focusSelected = true;
  }

  private onFieldKey(event: KeyboardEvent): void {
    // Nothing the field hears reaches the tree or the window's keybindings.
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
    }
  }

  /** Key up of the ContextMenu key: the menu opened on key down, so Chromium's is not asked. */
  private onKeyUp(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement) return;
    if (isMenuKey(event.key, event.shiftKey)) event.preventDefault();
  }

  private onContextMenu(event: MouseEvent, row?: ExplorerRow & { type: 'entry' }): void {
    event.preventDefault();
    event.stopPropagation();
    void this.openMenu(event.clientX, event.clientY, row);
  }

  /**
   * Shift+F10 or the ContextMenu key (TYTO-364): the menu a right click opens, under the left
   * edge of the selected row, or of the focused one when none is selected and the menu is the
   * empty space's.
   */
  private async menuFromKey(id: string | null, focused: EventTarget | null): Promise<void> {
    const row =
      id === null
        ? undefined
        : rowsOf(this.tree).find(
            (each): each is ExplorerRow & { type: 'entry' } =>
              each.type === 'entry' && each.entry.id === id,
          );
    const anchor =
      (id === null
        ? undefined
        : this.querySelector<HTMLElement>('.explorer__row[aria-selected="true"]')) ??
      (focused instanceof HTMLElement ? focused : undefined);
    const box = anchor?.getBoundingClientRect();
    await this.openMenu(box?.left ?? 0, box?.bottom ?? 0, row);
  }

  /** The context menu at a point: four items on a row, the two New items on the empty space. */
  private async openMenu(
    x: number,
    y: number,
    row?: ExplorerRow & { type: 'entry' },
  ): Promise<void> {
    if (this.folderName === null || this.folderName === undefined) return;
    if (this.tree.editing !== undefined || this.menuOpen) return;
    this.notice = undefined;
    if (row !== undefined) this.tree = withSelected(this.tree, row.entry.id);
    const ids: readonly MenuId[] =
      row === undefined
        ? [EXPLORER_MENU.newFile, EXPLORER_MENU.newFolder]
        : [
            EXPLORER_MENU.newFile,
            EXPLORER_MENU.newFolder,
            EXPLORER_MENU.rename,
            EXPLORER_MENU.delete,
          ];
    const items = ids.map((id) => ({ id, label: this.say(id), enabled: true }));
    this.menuOpen = true;
    let chosen: string | null;
    try {
      chosen = await this.source.menu(x, y, items);
    } finally {
      this.menuOpen = false;
    }
    // On the panel's empty space a new entry goes in the open folder itself.
    const parent = row === undefined ? null : undefined;
    if (chosen === EXPLORER_MENU.newFile) this.startNew('file', parent);
    else if (chosen === EXPLORER_MENU.newFolder) this.startNew('folder', parent);
    else if (chosen === EXPLORER_MENU.rename && row !== undefined) {
      this.tree = startRenaming(this.tree, row.entry.id);
    } else if (chosen === EXPLORER_MENU.delete && row !== undefined) {
      await this.trashEntry(row.entry.id);
    }
  }

  protected override updated(): void {
    const field = this.querySelector<HTMLInputElement>('.explorer__field');
    if (field !== null) {
      if (field.dataset.focused !== 'yes') {
        // Once, when the field appears: a rename selects the name up to its extension.
        field.dataset.focused = 'yes';
        field.focus();
        const dot = field.value.lastIndexOf('.');
        field.setSelectionRange(0, dot > 0 ? dot : field.value.length);
      }
      return;
    }
    // The selected row takes the focus while the tree has it, so arrows keep their place.
    const tree = this.querySelector<HTMLElement>('.explorer__tree');
    if (tree === null) return;
    if (!this.focusSelected && !tree.contains(document.activeElement)) return;
    const selected = this.querySelector<HTMLElement>('.explorer__row[aria-selected="true"]');
    if (selected === null) return;
    this.focusSelected = false;
    selected.focus();
  }

  /**
   * New File, New Folder and Collapse All in the tool header (TYTO-365), only while a folder is
   * open: the first two start the context menu's field where `startCreating` puts it. No
   * Refresh: the tree re-lists on main's watcher (ADR 0115).
   */
  private headerActions(): unknown {
    if (this.folderName === null || this.folderName === undefined) return nothing;
    const button = (
      action: string,
      key: CatalogueKey,
      name: IconName,
      run: () => void,
    ): unknown => {
      const label = this.say(key);
      return html`<button
        type="button"
        class="tool__action"
        data-action=${action}
        title=${label}
        aria-label=${label}
        @click=${run}
      >
        ${icon(name)}
      </button>`;
    };
    // A field still open takes the click as leaving it, which confirms its name, as the
    // context menu waits for it to close.
    const startNew = (kind: 'file' | 'folder'): void => {
      if (this.tree.editing === undefined) this.startNew(kind);
    };
    return html`${button('explorer.newFile', EXPLORER_MENU.newFile, 'newFile', () => {
      startNew('file');
    })}${button('explorer.newFolder', EXPLORER_MENU.newFolder, 'newFolder', () => {
      startNew('folder');
    })}${button('explorer.collapseAll', 'explorer.collapseAll', 'collapseAll', () => {
      this.notice = undefined;
      this.tree = collapseAll(this.tree);
    })}`;
  }

  protected override render(): unknown {
    return html`${this.bar('explorer-heading', 'explorer.heading', this.headerActions())}
      <div
        class="explorer__body"
        data-font-area="explorer"
        @contextmenu=${(event: MouseEvent) => {
          this.onContextMenu(event);
        }}
      >
        ${this.body()}
      </div>`;
  }

  private body(): unknown {
    if (this.folderName === undefined) return nothing;
    if (this.folderName === null) {
      return html`<p class="explorer__note">${this.say('explorer.none')}</p>
        <button
          type="button"
          class="explorer__open-folder"
          @click=${() => {
            this.source.openFolder();
          }}
        >
          ${this.say('command.workspace.openFolder')}
        </button>`;
    }
    const rows = rowsOf(this.tree);
    if (this.tree.root !== undefined && rows.length === 0) {
      return html`<p class="explorer__note">${this.say('explorer.empty')}</p>`;
    }
    const first = rows.find((row) => row.type === 'entry');
    const focusable = this.tree.selected ?? (first?.type === 'entry' ? first.entry.id : '');
    return html`<ul
      class="explorer__tree"
      role="tree"
      aria-label=${this.folderName}
      @keydown=${(event: KeyboardEvent) => {
        this.onKey(event);
      }}
      @keyup=${(event: KeyboardEvent) => {
        this.onKeyUp(event);
      }}
    >
      ${repeat(
        rows,
        (row) =>
          row.type === 'entry'
            ? row.entry.id
            : row.type === 'new'
              ? '\u0000new'
              : `\u0000more:${row.parent ?? ''}`,
        (row) => this.row(row, focusable),
      )}
    </ul>`;
  }

  /** The name field, with the line main's refusal left under it. */
  private field(label: CatalogueKey): unknown {
    const editing = this.tree.editing;
    if (editing === undefined) return nothing;
    const error = editing.error;
    return html`<input
        class="explorer__field"
        type="text"
        spellcheck="false"
        aria-label=${this.say(label)}
        aria-invalid=${error === undefined ? 'false' : 'true'}
        .value=${live(editing.draft)}
        @input=${(event: InputEvent) => {
          this.tree = withDraft(this.tree, (event.target as HTMLInputElement).value);
        }}
        @keydown=${(event: KeyboardEvent) => {
          this.onFieldKey(event);
        }}
        @blur=${() => {
          // Leaving the field confirms it, as in VS Code.
          void this.commit();
        }}
        @click=${(event: MouseEvent) => {
          event.stopPropagation();
        }}
      />${
        error === undefined
          ? nothing
          : html`<span class="explorer__error" role="alert">${error}</span>`
      }`;
  }

  private row(row: ExplorerRow, focusable: string): unknown {
    const indent = `padding-inline-start: ${String(row.depth * INDENT + 4)}px`;
    if (row.type === 'more') {
      // Past the chevron's width, so the count lines up with the names above it.
      const under = `padding-inline-start: ${String(row.depth * INDENT + 4 + INDENT)}px`;
      return html`<li class="explorer__more" role="none" style=${under}>
        ${this.say('explorer.more').replaceAll('{count}', String(row.count))}
      </li>`;
    }
    if (row.type === 'new') {
      const kind = row.kind === 'folder' ? 'folder' : 'file';
      return html`<li class="explorer__new explorer__row--editing" role="none" style=${indent}>
        <span class="explorer__chevron"></span
        ><span class="explorer__icon">${icon(kind === 'folder' ? 'folder' : 'file')}</span
        >${this.field(kind === 'folder' ? 'explorer.menu.newFolder' : 'explorer.menu.newFile')}
      </li>`;
    }
    const { entry } = row;
    const folder = entry.kind === 'folder';
    const selected = this.tree.selected === entry.id;
    const fileIcon = fileIconFor({ ...entry, expanded: row.expanded });
    const notice = this.notice?.id === entry.id ? this.notice.text : undefined;
    return html`<li
      class="explorer__row ${row.renaming === true ? 'explorer__row--editing' : ''}"
      role="treeitem"
      data-kind=${entry.kind}
      data-icon=${fileIcon}
      data-name=${entry.name}
      aria-level=${row.depth + 1}
      aria-expanded=${folder ? String(row.expanded) : nothing}
      aria-selected=${String(selected)}
      tabindex=${entry.id === focusable ? 0 : -1}
      title=${entry.name}
      style=${indent}
      @click=${() => {
        if (row.renaming !== true) this.activate(row);
      }}
      @contextmenu=${(event: MouseEvent) => {
        this.onContextMenu(event, row);
      }}
    >
      <span class="explorer__chevron"
        >${folder ? icon(row.expanded ? 'chevronDown' : 'chevronRight') : nothing}</span
      ><span class="explorer__icon">${icon(fileIcon)}</span>${
        row.renaming === true
          ? this.field('explorer.menu.rename')
          : html`<span class="explorer__name">${entry.name}</span>`
      }${
        notice === undefined
          ? nothing
          : html`<span class="explorer__error" role="alert">${notice}</span>`
      }
    </li>`;
  }
}

customElements.define(EXPLORER_PANEL_TAG, ExplorerPanel);

declare global {
  interface HTMLElementTagNameMap {
    [EXPLORER_PANEL_TAG]: ExplorerPanel;
  }
}
