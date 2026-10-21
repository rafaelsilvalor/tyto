import { html } from 'lit';

import type { CatalogueKey } from '../../shared/i18n/index.js';
import type { IpcResponse } from '../../shared/ipc.js';
import { DockedPanel } from './panels.js';

/**
 * The Project panel (TYTO-347, ADR 0114): the places the open workspace folder resolves — its
 * asset, template and font folders and its output folder — and, for each, whether the value
 * came from the work profile the folder names or from the folder itself. Rafael chose a panel
 * beside Problems on 2026-10-21, opened by Workspace: Show Project and from the trust strip.
 *
 * **Read only, and it holds no bridge.** It is handed main's `workspace:folder` answer, as the
 * trust strip is, and draws it; a place changes by editing `project.json` or the profile.
 * One line per key, always all four, so a key nobody set reads "not set" rather than being a
 * gap a person has to notice.
 */

export const PROJECT_PANEL_TAG = 'tyto-project-panel';

export type ProjectView = IpcResponse<'workspace:folder'>;
type PlaceKey = ProjectView['places'][number]['key'];

export const PLACE_KEYS: readonly PlaceKey[] = ['assets', 'templates', 'fonts', 'output'];

/** The words a line's tag says: `profile saude`, `this folder`, or `not set`. */
export function originLabel(
  view: ProjectView,
  key: PlaceKey,
  say: (key: CatalogueKey) => string,
): string {
  const place = view.places.find((item) => item.key === key);
  if (place === undefined) return say('project.unset');
  if (place.origin === 'folder') return say('project.origin.folder');
  return say('project.origin.profile').replaceAll('{name}', view.profile?.label ?? '');
}

export class ProjectPanel extends DockedPanel {
  static override properties = {
    ...DockedPanel.properties,
    view: { attribute: false },
  };

  /** The open folder as main answered it, or nothing while it is asked. */
  declare view: ProjectView | undefined;

  constructor() {
    super();
    this.view = undefined;
  }

  protected override render(): unknown {
    const view = this.view;
    const say = (key: CatalogueKey): string => this.say(key);
    return html`${this.bar('project-heading', 'project.heading')}
      <div class="project__body">
        ${
          view === undefined || view.folder === null
            ? html`<p class="project__none">${say('project.none')}</p>`
            : html`<ul class="project__places">
                ${PLACE_KEYS.map((key) => {
                  const place = view.places.find((item) => item.key === key);
                  return html`<li class="project__place" data-key=${key}>
                    <span class="project__key">${key}</span>
                    <span class="project__value">${place?.folders.join(', ') ?? ''}</span>
                    <span class="project__origin" data-origin=${place?.origin ?? 'unset'}>
                      ${originLabel(view, key, say)}
                    </span>
                  </li>`;
                })}
              </ul>`
        }
      </div>`;
  }
}

customElements.define(PROJECT_PANEL_TAG, ProjectPanel);

declare global {
  interface HTMLElementTagNameMap {
    [PROJECT_PANEL_TAG]: ProjectPanel;
  }
}
