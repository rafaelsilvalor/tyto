import { LitElement, html, nothing } from 'lit';

import { type Locale, DEFAULT_LOCALE, translate } from '../../shared/i18n/index.js';
import { type EditorGroups, type GroupNode, groupList } from './editor-groups.js';
import { footprintOf } from './group-resize.js';
import { icon } from './icons.js';
import { splitterFor } from './group-splitter.js';
// Imported for the side effect: the pane has to be defined before a group makes one.
import { type PreviewPane, PREVIEW_PANE_TAG } from './preview-pane.js';
// Imported for the side effect: the strip has to be defined before a group renders one.
import { type TabEntry, TABS_TAG } from './tabs.js';

/**
 * One editor group on screen (TYTO-286, ADR 0083): its own row of tabs on top, a header row
 * under it, and the node a CodeMirror pane is mounted in under that.
 *
 * Shaped as a **pane** (TYTO-288, ADR 0085) — a strip, a header row, then the content. The
 * strip is every pane's height, a docked panel's too, and holds the tabs and, at its right end,
 * the group's actions, as VS Code's editor actions sit (Rafael's reference of 2026-10-14). The
 * header row is discreet, the editor's own background and no line, and holds the breadcrumb
 * slot TYTO-273 fills; with a preview in front it is hidden, because the preview's own bar is
 * that row. It holds no state: which tabs it has and which is in front are `editor-groups.ts`'s,
 * handed down by `main.ts`, and a click reports back.
 *
 * The mount is rendered once and kept: Lit leaves a node it did not have to change, and the
 * group's own element is moved, never rebuilt, when the tree is rearranged
 * ({@link arrangeGroups}), which also gives the first group's mount `id="editor"`, so a window
 * with one group is the window every earlier suite and stylesheet knows.
 */

export const EDITOR_GROUP_TAG = 'tyto-editor-group';

export class EditorGroupElement extends LitElement {
  static override properties = {
    groupId: { attribute: false },
    tabs: { attribute: false },
    activeTabId: { attribute: false },
    focused: { attribute: false },
    locale: { attribute: false },
    select: { attribute: false },
    close: { attribute: false },
    showing: { attribute: false },
    offerPreview: { attribute: false },
    openPreview: { attribute: false },
  };

  declare groupId: string;
  declare tabs: readonly TabEntry[];
  declare activeTabId: string;
  declare focused: boolean;
  declare locale: Locale;
  declare select: (tabId: string) => void;
  declare close: (tabId: string) => void;
  /** What the tab in front is (TYTO-287): text in the CodeMirror pane, or a brief's art. */
  declare showing: 'editor' | 'preview';
  /** Whether the strip offers "Open preview to the side": a brief is in front. */
  declare offerPreview: boolean;
  declare openPreview: () => void;

  constructor() {
    super();
    this.groupId = '';
    this.tabs = [];
    this.activeTabId = '';
    this.focused = false;
    this.locale = DEFAULT_LOCALE;
    this.select = () => undefined;
    this.close = () => undefined;
    this.showing = 'editor';
    this.offerPreview = false;
    this.openPreview = () => undefined;
  }

  private ownMount: HTMLElement | undefined;
  private ownPreview: PreviewPane | undefined;

  /**
   * The preview pane a preview tab in front is drawn in (TYTO-287), made the first time this
   * group shows a preview and kept beside the CodeMirror mount afterwards, so switching between a
   * brief and its preview moves nothing. Not made before: a group that never showed a preview
   * holds none of its nodes, as a closed panel holds none (ADR 0024).
   */
  get preview(): PreviewPane {
    if (this.ownPreview === undefined) {
      this.ownPreview = document.createElement(PREVIEW_PANE_TAG);
      this.ownPreview.hidden = this.showing !== 'preview';
      if (this.mount.parentNode === null) this.append(this.ownPreview);
      else this.mount.after(this.ownPreview);
    }
    return this.ownPreview;
  }

  /** The preview pane if this group has made one. */
  get previewIfMade(): PreviewPane | undefined {
    return this.ownPreview;
  }

  /**
   * The node CodeMirror is mounted in. Made by the element and not by its template, so it
   * exists the moment the element is connected — a pane is created in the same turn as its
   * group — and no render can ever replace it.
   */
  get mount(): HTMLElement {
    if (this.ownMount === undefined) {
      this.ownMount = document.createElement('div');
      this.ownMount.className = 'editor';
    }
    return this.ownMount;
  }

  /** Light DOM, so `shell.css` reaches inside — the reasoning is in ADR 0024. */
  protected override createRenderRoot(): HTMLElement {
    this.append(this.mount);
    // The strip renders in front of the mount; the mount and a preview pane stay after it.
    this.renderOptions.renderBefore = this.mount;
    return this;
  }

  protected override render(): unknown {
    this.dataset['editorGroup'] = this.groupId;
    this.classList.toggle('editor-group--focused', this.focused);
    this.mount.hidden = this.showing === 'preview';
    const pane = this.showing === 'preview' ? this.preview : this.ownPreview;
    if (pane !== undefined) pane.hidden = this.showing !== 'preview';
    const open = translate(this.locale, 'command.preview.openToSide');
    // The pane shape (ADR 0085): the strip — the tabs, then the group's actions at its right
    // end — and the header row, which holds the breadcrumb slot alone. With a preview in front
    // the row is hidden and the preview's bar, a header row of its own, takes its place.
    return html`<div class="pane__strip">
        <tyto-tabs
          class="tabs"
          .tabs=${this.tabs}
          .activeId=${this.activeTabId}
          .locale=${this.locale}
          .select=${this.select}
          .close=${this.close}
        ></tyto-tabs>
        <div class="pane__actions">
          ${
            this.offerPreview
              ? html`<button
                  type="button"
                  class="editor-group__action"
                  data-action="preview.openToSide"
                  title=${open}
                  aria-label=${open}
                  @click=${() => {
                    this.openPreview();
                  }}
                >
                  ${icon('preview')}
                </button>`
              : nothing
          }
        </div>
      </div>
      <div class="pane__header" ?hidden=${this.showing === 'preview'}>
        <div class="pane__breadcrumb" data-breadcrumb></div>
      </div>`;
  }
}

customElements.define(EDITOR_GROUP_TAG, EditorGroupElement);

declare global {
  interface HTMLElementTagNameMap {
    [EDITOR_GROUP_TAG]: EditorGroupElement;
  }
}

// Named so the import above stays a runtime one: the strip is a custom element by tag.
void TABS_TAG;

/**
 * Tells the window how much room the groups take at their minimum, as `--tyto-groups-min-width`
 * and `--tyto-groups-min-height` on `.workspace`: the centre dock is held at that width and the
 * docks' row at that height, so the side and bottom docks give way before a group is squeezed
 * (TYTO-299, ADR 0093). The workspace and not the container, because the docks are above it.
 */
function publishFootprint(container: HTMLElement, root: GroupNode): void {
  const workspace = container.closest<HTMLElement>('.workspace');
  if (workspace === null) return;
  workspace.style.setProperty('--tyto-groups-min-width', `${String(footprintOf(root, 'row'))}px`);
  workspace.style.setProperty(
    '--tyto-groups-min-height',
    `${String(footprintOf(root, 'column'))}px`,
  );
}

/**
 * Lays the groups out in `container`: a box per split, children in its direction at their
 * shares, and each group's element — made the first time its id is seen, **moved** afterwards —
 * at its leaf. An element whose group is gone is removed and reported, so its pane can go.
 */
export function arrangeGroups(
  container: HTMLElement,
  groups: EditorGroups,
  made: Map<string, EditorGroupElement>,
): { readonly created: readonly EditorGroupElement[]; readonly removed: readonly string[] } {
  const created: EditorGroupElement[] = [];
  const build = (node: GroupNode): HTMLElement => {
    if (node.kind === 'group') {
      let element = made.get(node.id);
      if (element === undefined) {
        element = document.createElement(EDITOR_GROUP_TAG);
        element.groupId = node.id;
        // Now and not at the first render, which is a microtask away: focus is routed by it.
        element.dataset['editorGroup'] = node.id;
        made.set(node.id, element);
        created.push(element);
      }
      element.classList.add('editor-group');
      return element;
    }
    const box = document.createElement('div');
    box.className = `editor-split editor-split--${node.direction}`;
    box.dataset['groupSplit'] = node.id;
    // Never narrower or shorter than its groups at their minimum, or the next sibling is painted
    // over the ones that spill out of it (TYTO-299, ADR 0093).
    box.style.minWidth = `${String(footprintOf(node, 'row'))}px`;
    box.style.minHeight = `${String(footprintOf(node, 'column'))}px`;
    node.children.forEach((child, index) => {
      // The line between this child and the one before it (TYTO-289).
      if (index > 0) box.append(splitterFor(node, index - 1));
      const built = build(child);
      // A share as a grow factor, so the shares hold whatever size the panel is.
      built.style.flex = `${String(node.sizes[index] ?? 1)} 1 0`;
      box.append(built);
    });
    return box;
  };

  const root = build(groups.root);
  // The first group in tree order holds `#editor`, wherever the others went.
  groupList(groups).forEach((group, index) => {
    const mount = made.get(group.id)?.mount;
    if (mount === undefined) return;
    if (index === 0) mount.id = 'editor';
    else mount.removeAttribute('id');
  });
  root.style.flex = '1 1 0';
  publishFootprint(container, groups.root);
  // `replaceChildren` moves the group elements, and a moved node is not re-rendered by Lit:
  // the strip and the CodeMirror inside it come along as they are.
  container.replaceChildren(root);

  const alive = new Set(groupList(groups).map((group) => group.id));
  const removed: string[] = [];
  for (const id of [...made.keys()]) {
    if (alive.has(id)) continue;
    made.get(id)?.remove();
    made.delete(id);
    removed.push(id);
  }
  return { created, removed };
}
