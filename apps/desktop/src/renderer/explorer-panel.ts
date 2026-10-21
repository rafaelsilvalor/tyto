import { html, nothing } from 'lit';

import {
  type ExplorerListing,
  type ExplorerRow,
  type ExplorerTree,
  EMPTY_TREE,
  foldersToRelist,
  moveFor,
  rowsOf,
  withExpanded,
  withListing,
  withSelected,
} from './explorer-tree.js';
import { icon } from './icons.js';
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
 * The tree is a value (`explorer-tree.ts`); this element draws it and turns clicks and keys into
 * the next value. It lives as long as the dock keeps it: closing the panel forgets which folders
 * were open, as closing the queue forgets its scroll.
 */

export const EXPLORER_PANEL_TAG = 'tyto-explorer-panel';

/** What the panel asks of the window. `main.ts` wires each to the bridge. */
export interface ExplorerSource {
  readonly list: (entryId: string | null) => Promise<ExplorerListing>;
  readonly open: (entryId: string) => void;
  /** File ▸ Open Folder, offered while no folder is open. */
  readonly openFolder: () => void;
}

const idle: ExplorerSource = {
  list: () => Promise.resolve({ entries: [], more: 0, gone: true }),
  open: () => undefined,
  openFolder: () => undefined,
};

/** Pixels each level indents, the width of a chevron, so a file lines up under its folder's name. */
const INDENT = 16;

export class ExplorerPanel extends DockedPanel {
  static override properties = {
    ...DockedPanel.properties,
    folderName: { attribute: false },
    source: { attribute: false },
    tree: { state: true },
  };

  /** The open folder's name, `null` with none open, nothing while main is asked. */
  declare folderName: string | null | undefined;
  declare source: ExplorerSource;
  declare tree: ExplorerTree;

  /** Bumped by `reset`, so an answer for a folder that has since closed is not drawn. */
  private generation = 0;

  constructor() {
    super();
    this.folderName = undefined;
    this.source = idle;
    this.tree = EMPTY_TREE;
  }

  /** Forgets the tree and lists the open folder from the top: another folder was opened. */
  reset(): void {
    this.generation += 1;
    this.tree = EMPTY_TREE;
    if (this.folderName !== null && this.folderName !== undefined) void this.relist([null]);
  }

  /** Lists again every open folder on screen: main heard a change on disk. */
  refresh(): void {
    if (this.folderName === null || this.folderName === undefined) return;
    void this.relist(foldersToRelist(this.tree));
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
    if (entry.kind === 'folder') {
      this.toggle(entry.id, !row.expanded);
      return;
    }
    this.tree = withSelected(this.tree, entry.id);
    if (entry.kind === 'brief') this.source.open(entry.id);
  }

  private onKey(event: KeyboardEvent): void {
    const move = moveFor(this.tree, event.key);
    if (move === undefined) return;
    event.preventDefault();
    if (move.do === 'select') this.tree = withSelected(this.tree, move.id);
    else if (move.do === 'expand') this.toggle(move.id, move.open);
    else this.source.open(move.id);
  }

  protected override updated(): void {
    // The selected row takes the focus while the tree has it, so arrows keep their place.
    const tree = this.querySelector<HTMLElement>('.explorer__tree');
    if (tree === null || !tree.contains(document.activeElement)) return;
    this.querySelector<HTMLElement>('.explorer__row[aria-selected="true"]')?.focus();
  }

  protected override render(): unknown {
    return html`${this.bar('explorer-heading', 'explorer.heading')}
      <div class="explorer__body" data-font-area="explorer">${this.body()}</div>`;
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
    const focusable = this.tree.selected ?? (rows[0]?.type === 'entry' ? rows[0].entry.id : '');
    return html`<ul
      class="explorer__tree"
      role="tree"
      aria-label=${this.folderName}
      @keydown=${(event: KeyboardEvent) => {
        this.onKey(event);
      }}
    >
      ${rows.map((row) => this.row(row, focusable))}
    </ul>`;
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
    const { entry } = row;
    const folder = entry.kind === 'folder';
    const selected = this.tree.selected === entry.id;
    return html`<li
      class="explorer__row"
      role="treeitem"
      data-kind=${entry.kind}
      data-name=${entry.name}
      aria-level=${row.depth + 1}
      aria-expanded=${folder ? String(row.expanded) : nothing}
      aria-selected=${String(selected)}
      tabindex=${entry.id === focusable ? 0 : -1}
      title=${entry.name}
      style=${indent}
      @click=${() => {
        this.activate(row);
      }}
    >
      <span class="explorer__chevron"
        >${folder ? icon(row.expanded ? 'chevronDown' : 'chevronRight') : nothing}</span
      ><span class="explorer__name">${entry.name}</span>
    </li>`;
  }
}

customElements.define(EXPLORER_PANEL_TAG, ExplorerPanel);

declare global {
  interface HTMLElementTagNameMap {
    [EXPLORER_PANEL_TAG]: ExplorerPanel;
  }
}
