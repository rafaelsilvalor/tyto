import type { LoadedWorkspace } from '@tyto/io';

import type { TaskSources } from './render-task.js';

/**
 * Whether a run may ask a plugin's `asset-source` or `font-source` for what its cache lacks
 * (ADR 0117), decided by where the brief came from (ADR 0118).
 *
 * The question ADR 0111 answers for a folder — did somebody decide to trust what this text
 * asks installed code to do? — has an answer for each way a brief reaches the CLI:
 *
 * - **In a workspace**: its trust, with `--trust` counting for the run. A restricted folder
 *   reads the cache and fetches nothing, and its sections are already withheld.
 * - **In no workspace**: fetched. The person typed the brief's path, there is no folder whose
 *   trust is in question, and no section to withhold.
 * - **`tyto watch`**: never fetched. An inbox is filled unattended by another system, and a
 *   folder picked up unattended must not change what it produces the day somebody installs a
 *   plugin — the reason the desktop's queue stays PNG-only. What the cache already holds is
 *   still drawn, so rendering the brief once with `tyto render` is what fills it.
 */

/** What a miss says under `tyto watch`, where trusting the folder would change nothing. */
export const WATCH_NEVER_FETCHES =
  'tyto watch never fetches from a plugin; render the brief once with `tyto render` to fetch it, and the watcher reads it from then on';

export function renderSources(
  home: string | undefined,
  workspace: LoadedWorkspace | undefined,
): TaskSources | undefined {
  if (home === undefined) return undefined;
  if (workspace === undefined) return { home, fetches: true };
  return {
    home,
    fetches: workspace.trust === 'trusted',
    sections: workspace.project.sections,
  };
}

/** Spread into `RenderTaskOptions`, which under `exactOptionalPropertyTypes` takes no `undefined`. */
export function optionalSources(sources: TaskSources | undefined): {
  readonly sources?: TaskSources;
} {
  return sources === undefined ? {} : { sources };
}

export function watchSources(home: string | undefined): TaskSources | undefined {
  return home === undefined
    ? undefined
    : { home, fetches: false, notFetchedBecause: WATCH_NEVER_FETCHES };
}
