import type { LoadedWorkspace } from '@tyto/io';

import type { SectionOverrides } from './options.js';
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
  typed: SectionOverrides = {},
): TaskSources | undefined {
  if (home === undefined) return undefined;
  const sections = projectSections(workspace, typed);
  const handed = Object.keys(sections).length === 0 ? {} : { sections };
  if (workspace === undefined) return { home, fetches: true, ...handed };
  return { home, fetches: workspace.trust === 'trusted', ...handed };
}

/**
 * Each plugin's section for this run, by plugin id (ADR 0147): the workspace's, which a
 * restricted folder has already withheld, with the keys typed in `--section` shallow-merged
 * over its plugin's. **Typed keys apply in a restricted folder too**: the person typing the
 * command is the approval, as `tyto trust add` takes it, and they lift nothing the file says.
 * A file section that is not an object is replaced by the typed keys.
 */
export function projectSections(
  workspace: LoadedWorkspace | undefined,
  typed: SectionOverrides,
): Readonly<Record<string, unknown>> {
  const sections: Record<string, unknown> = { ...workspace?.project.sections };
  for (const [plugin, keys] of Object.entries(typed)) {
    const file = sections[plugin];
    const base = typeof file === 'object' && file !== null && !Array.isArray(file) ? file : {};
    sections[plugin] = { ...base, ...keys };
  }
  return sections;
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
