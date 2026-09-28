import { type FSWatcher, watch } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { KIT_SOURCE } from './paths.ts';

import type { PreviewSession, PreviewTarget } from './session.ts';

/**
 * Re-renders when anything the picture is drawn from changes: the template folder, the brief,
 * and — for a template compiled into the build — the brand module beside it and
 * `@tyto/template-kit` (TYTO-181).
 *
 * `fs.watch` and not a poll, unlike `tyto watch`'s inbox: this runs on the machine the
 * files are being typed on, never on a network share, and a poll interval would be added
 * to every save-to-picture measurement. Editors save in bursts (a temp file, a rename, a
 * metadata touch), so events are gathered for a short quiet period and answered once.
 *
 * **What a code template draws with is wider than its folder.** Its parts import a brand
 * module (`_azul/`, a sibling folder with no manifest — ADR 0047) and the kit, and
 * a save to either used to leave the page drawing the build from before. Both are watched now;
 * the kit asks for its own rebuild, because `@tyto/templates` imports the kit's `dist/` rather
 * than bundling it.
 */

export const QUIET_MS = 80;

/** What makes a save need a rebuild before the render: code, not markup or data. */
const CODE_FILE = /\.(?:ts|mts|cts|js|mjs)$/;

/** A test file is not what a render imports, and saving one should not cost a rebuild. */
const TEST_FILE = /\.test\.[cm]?[jt]s$/;

/**
 * Whether `path` is inside `folder`.
 *
 * `relative` answers `..\…` for a path outside the folder on the same drive, and the path
 * itself — absolute — for one on another drive: `D:\templates` and `C:\…\brief` have no
 * relative path at all. Reading only the `..` took a brief on another drive for one inside the
 * template folder, so it was never watched and a save to it left the picture from before
 * (found by TYTO-181, with the brief in a temp folder on C: and the pack on D:).
 */
export function isInside(folder: string, path: string): boolean {
  const between = relative(folder, path);
  return between !== '' && !between.startsWith('..') && !isAbsolute(between);
}

/** A brand module is a folder of the pack whose name starts with `_` (ADR 0047). */
const isBrandModule = (folder: string): boolean => folder.startsWith('_');

export interface WatchOptions {
  /** The kit's source folder; the repository's own unless a test points elsewhere. */
  readonly kitSource?: string;
}

export function watchTarget(
  target: PreviewTarget,
  session: PreviewSession,
  options: WatchOptions = {},
): () => void {
  const watchers: FSWatcher[] = [];

  let timer: ReturnType<typeof setTimeout> | undefined;
  let rebuild = false;
  let kit = false;

  const changed = (file: string | null, from: 'pack' | 'kit' | 'brief'): void => {
    const code = file !== null && CODE_FILE.test(file) && !TEST_FILE.test(file);
    if (code && from === 'kit') kit = true;
    if (code && from !== 'kit') rebuild = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const request = { rebuild, kit };
      rebuild = false;
      kit = false;
      void session.request(request);
    }, QUIET_MS);
  };

  // The pack folder rather than the template's own, so the brand module beside it is seen;
  // a save to another template of the pack is not this picture's business and is ignored.
  watchers.push(
    watch(target.templates, { recursive: true }, (_event, file) => {
      if (file === null) return;
      const [folder = ''] = file.split(/[\\/]/u);
      const brand = target.compiled && isBrandModule(folder);
      if (folder === target.template || brand) changed(file, 'pack');
    }),
  );

  if (target.compiled) {
    const kitSource = options.kitSource ?? KIT_SOURCE;
    watchers.push(watch(kitSource, { recursive: true }, (_event, file) => changed(file, 'kit')));
  }

  // The brief is usually `examples/…` inside the template folder; one outside it gets its own.
  const templateFolder = join(target.templates, target.template);
  if (!isInside(templateFolder, target.brief)) {
    const briefName = relative(dirname(target.brief), target.brief);
    watchers.push(
      watch(dirname(target.brief), (_event, file) => {
        if (file === briefName) changed(file, 'brief');
      }),
    );
  }

  return () => {
    if (timer !== undefined) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}
