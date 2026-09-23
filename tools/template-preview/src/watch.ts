import { type FSWatcher, watch } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import type { PreviewSession, PreviewTarget } from './session.ts';

/**
 * Re-renders when the template folder or the brief changes.
 *
 * `fs.watch` and not a poll, unlike `tyto watch`'s inbox: this runs on the machine the
 * files are being typed on, never on a network share, and a poll interval would be added
 * to every save-to-picture measurement. Editors save in bursts (a temp file, a rename, a
 * metadata touch), so events are gathered for a short quiet period and answered once.
 */

export const QUIET_MS = 80;

/** What makes a save need a rebuild before the render: code, not markup or data. */
const CODE_FILE = /\.(?:ts|mts|cts|js|mjs)$/;

export function watchTarget(target: PreviewTarget, session: PreviewSession): () => void {
  const templateFolder = join(target.templates, target.template);
  const watchers: FSWatcher[] = [];

  let timer: ReturnType<typeof setTimeout> | undefined;
  let rebuild = false;

  const changed = (file: string | null): void => {
    if (file !== null && CODE_FILE.test(file)) rebuild = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const needsRebuild = rebuild;
      rebuild = false;
      void session.request({ rebuild: needsRebuild });
    }, QUIET_MS);
  };

  watchers.push(watch(templateFolder, { recursive: true }, (_event, file) => changed(file)));

  // The brief is usually `examples/…` inside the folder above; one outside it gets its own.
  const briefOutside = relative(templateFolder, target.brief).startsWith('..');
  if (briefOutside) {
    const briefName = relative(dirname(target.brief), target.brief);
    watchers.push(
      watch(dirname(target.brief), (_event, file) => {
        if (file === briefName) changed(file);
      }),
    );
  }

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}
