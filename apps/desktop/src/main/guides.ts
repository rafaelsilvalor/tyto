import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve as resolvePath } from 'node:path';

import { parseBrief } from '@tyto/brief-lang';
import {
  type Diagnostics,
  type TemplateConfigurations,
  type TemplateRegistry,
  diagnostic,
  lineColumnAt,
  resolve,
} from '@tyto/core';
import { type GuideTarget, guideCandidates, guideOverwrite, guidePaths } from '@tyto/command-line';
import { EDITABLE_DIR, briefAssetResolver } from '@tyto/io';

import type { IpcRequest, IpcResponse } from '../../shared/ipc.js';

/**
 * The external-art guide for the window (TYTO-741, ADR 0222): which guides an open brief has,
 * and writing the ones a person picked, then opening each in the program the machine opens a
 * PSD with.
 *
 * **Which guides** is `@tyto/command-line`'s `guideCandidates` and `guidePaths` over the
 * registry the preview compiles with, so the list names a guide exactly as `tyto guide` does.
 * **Writing** runs `tyto guide <brief> --only <names>` in-process, through the command runner
 * the command panel uses (ADR 0159): `writeGuides` needs the render context `tyto guide`
 * builds from the brief's workspace and plugins, which the package keeps to itself, and a
 * second way of building it here is a second answer to "which templates and which faces".
 */

/** How a written guide reached the person: in its program, or shown in its folder instead. */
export type GuideOpenAnswer = 'opened' | 'no-program' | 'restricted';

/**
 * The system's way of opening and showing a file, built in the composition root from
 * `shell.openPath` and `shell.showItemInFolder`, looked up at every call so an end-to-end
 * suite can stand in for both through `app.evaluate`.
 */
export interface GuideOpener {
  /** `shell.openPath`'s answer: empty when a program opened it, the reason otherwise. */
  open(path: string): Promise<string>;
  reveal(path: string): void;
}

/** What `tyto guide` printed and how it ended, as the command runner's `capture` answers. */
export interface CapturedGuideRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export interface GuideServiceOptions {
  /** The file main holds for a tab; the window never sends a path (ADR 0086). */
  readonly pathOf: (documentId: string) => string | undefined;
  /** The registry and configurations the preview compiles with, read per call. */
  readonly sources: () => {
    readonly registry: TemplateRegistry | undefined;
    readonly configurations: TemplateConfigurations;
  };
  /** The open workspace's asset folders for a brief in this folder. */
  readonly projectAssets: (briefDirectory: string) => readonly string[];
  /** Whether the brief's folder is a restricted one (ADR 0111): a guide is never opened there. */
  readonly restricted: (briefDirectory: string) => Promise<boolean>;
  /** Runs `tyto` with these words in `cwd`, as the command panel would, and captures it. */
  readonly capture: (argv: readonly string[], cwd: string) => Promise<CapturedGuideRun>;
  readonly opener: GuideOpener;
  /** The native question before a guide newer than the brief is written over (decision 4). */
  readonly askOverwrite: (names: readonly string[]) => Promise<boolean>;
}

export interface GuideService {
  candidates(request: IpcRequest<'guide:candidates'>): Promise<IpcResponse<'guide:candidates'>>;
  write(request: IpcRequest<'guide:write'>): Promise<IpcResponse<'guide:write'>>;
}

/** A guide target and what is on disk for it. */
interface GuideState extends GuideTarget {
  readonly name: string;
  readonly exists: boolean;
  readonly newer: boolean;
  readonly artExists: boolean;
}

function modifiedAt(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

type Found =
  | {
      readonly ok: true;
      readonly template: string;
      readonly formats: readonly string[];
      readonly states: readonly GuideState[];
      readonly found: ReturnType<typeof guideCandidates>;
      readonly source: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'no-file' | 'no-external-art' | 'not-resolved';
      readonly diagnostics: Diagnostics;
    };

export function createGuideService(options: GuideServiceOptions): GuideService {
  /** The brief's guides as `tyto guide --list` sees them, from `text` or the file. */
  async function find(
    briefPath: string,
    text: string | undefined,
    formats: readonly string[] | undefined,
  ): Promise<Found> {
    const briefDirectory = dirname(briefPath);
    let source: string;
    try {
      source = text ?? (await readFile(briefPath, 'utf8'));
    } catch {
      return { ok: false, reason: 'no-file', diagnostics: [] };
    }
    const parsed = parseBrief(source);
    if (!parsed.ok) return { ok: false, reason: 'not-resolved', diagnostics: parsed.error };
    const { registry, configurations } = options.sources();
    if (registry === undefined) return { ok: false, reason: 'not-resolved', diagnostics: [] };
    // A plugin directive is left out, as `tyto guide` leaves it: its slots cite no file in the
    // brief's text, and expanding it would ask the plugin.
    const resolved = await resolve(
      {
        ...parsed.value,
        directives: parsed.value.directives.filter((entry) => entry.namespace === undefined),
      },
      {
        registry,
        configurations,
        assets: briefAssetResolver({
          briefDirectory,
          projectAssets: options.projectAssets(briefDirectory),
        }),
        ...(formats === undefined ? {} : { formats }),
      },
    );
    if (!resolved.ok) return { ok: false, reason: 'not-resolved', diagnostics: resolved.error };
    const manifest = registry.get(resolved.value.template);
    if (manifest === undefined) return { ok: false, reason: 'not-resolved', diagnostics: [] };
    if (!Object.values(manifest.slots).some((slot) => slot.external !== undefined)) {
      return {
        ok: false,
        reason: 'no-external-art',
        diagnostics: [diagnostic('E_GUIDE_NO_EXTERNAL_ART', { template: manifest.name })],
      };
    }

    const found = guideCandidates(parsed.value, manifest);
    const briefModified = modifiedAt(briefPath) ?? 0;
    const location = {
      briefDirectory,
      delivery: basename(briefDirectory) === EDITABLE_DIR,
      exists: (path: string) => existsSync(path),
    };
    const seen = new Set<string>();
    const states: GuideState[] = [];
    for (const candidate of found.candidates) {
      for (const target of guidePaths(candidate, resolved.value.formats, location)) {
        if (seen.has(target.guide)) continue;
        seen.add(target.guide);
        const guideModified = modifiedAt(target.guide);
        states.push({
          ...target,
          name: basename(target.guide),
          exists: guideModified !== undefined,
          newer: guideModified !== undefined && guideModified > briefModified,
          artExists: existsSync(target.art),
        });
      }
    }
    return {
      ok: true,
      template: resolved.value.template,
      formats: resolved.value.formats,
      states,
      found,
      source,
    };
  }

  /** Opens each written guide; a restricted folder or a PSD with no program shows the folder. */
  async function open(written: readonly string[], briefDirectory: string) {
    const first = written[0];
    if (first === undefined) return 'opened' as const;
    if (await options.restricted(briefDirectory)) {
      options.opener.reveal(first);
      return 'restricted' as const;
    }
    let answer: GuideOpenAnswer = 'opened';
    for (const path of written) {
      // A non-empty answer is `shell.openPath` saying nothing opened it: no program is
      // associated with a PSD on this machine. The file is there; the folder shows it.
      if ((await options.opener.open(path)) !== '') {
        options.opener.reveal(path);
        answer = 'no-program';
      }
    }
    return answer;
  }

  return {
    async candidates({ documentId, text, formats }) {
      const briefPath = options.pathOf(documentId);
      if (briefPath === undefined) return { ok: false, reason: 'no-file', diagnostics: [] };
      const found = await find(briefPath, text, formats);
      if (!found.ok) {
        return {
          ok: false,
          reason: found.reason,
          diagnostics: found.diagnostics.map((item) => ({
            severity: item.severity,
            code: item.code,
            message: item.message,
            ...(item.range === undefined ? {} : { range: item.range }),
            ...(item.hint === undefined ? {} : { hint: item.hint }),
          })),
        };
      }
      const briefDirectory = dirname(briefPath);
      // Relative to the brief's folder: what a person reads, and never a path the window
      // could hand back (ADR 0086). `guide:write` names a guide by its file name.
      const shown = (path: string): string => relative(briefDirectory, path);
      const line = (offset: number): number => lineColumnAt(found.source, offset).line;
      return {
        ok: true,
        template: found.template,
        formats: [...found.formats],
        guides: found.states.map((state) => ({
          slot: state.slot,
          kind: state.kind,
          cited: state.cited,
          format: state.format,
          name: state.name,
          guide: shown(state.guide),
          art: shown(state.art),
          exists: state.exists,
          newer: state.newer,
          artExists: state.artExists,
        })),
        uncited: found.found.uncited.map((entry) => ({ ...entry })),
        unguided: found.found.unguided.map((entry) => ({
          slot: entry.slot,
          cited: entry.cited,
          reason: entry.reason,
          line: line(entry.range.start),
        })),
      };
    },

    async write({ documentId, only, formats, overwrite, unsaved }) {
      // ADR 0222, decision 5: the guide is rendered from the file, so a brief with unsaved
      // edits is asked to be saved first; the window says so.
      if (unsaved) return { outcome: 'refused', reason: 'unsaved' };
      const briefPath = options.pathOf(documentId);
      if (briefPath === undefined) return { outcome: 'refused', reason: 'no-file' };
      const found = await find(briefPath, undefined, formats);
      if (!found.ok) return { outcome: 'refused', reason: 'no-guide' };
      const chosen = found.states.filter((state) => only.includes(state.name));
      if (chosen.length !== new Set(only).size) return { outcome: 'refused', reason: 'no-guide' };

      // Decision 4: a guide newer than the brief may hold the designer's paint.
      const briefModified = modifiedAt(briefPath) ?? 0;
      const newer = chosen.filter(
        (state) =>
          guideOverwrite({
            ...(state.exists ? { guideModified: modifiedAt(state.guide) ?? 0 } : {}),
            briefModified,
            force: overwrite,
            interactive: true,
          }) === 'ask',
      );
      const force = overwrite || newer.length > 0;
      if (newer.length > 0 && !(await options.askOverwrite(newer.map((state) => state.name)))) {
        return { outcome: 'declined' };
      }

      const briefDirectory = dirname(briefPath);
      const run = await options.capture(
        [
          'guide',
          briefPath,
          '--only',
          ...chosen.map((state) => state.name),
          ...(force ? ['--force'] : []),
          ...(formats === undefined ? [] : ['--formats', formats.join(',')]),
        ],
        briefDirectory,
      );
      // `tyto guide` prints each guide it wrote on a line of its own, relative to its `cwd`.
      const printed = new Set(
        run.out
          .split(/\r?\n/u)
          .filter((line) => line !== '')
          .map((line) => resolvePath(briefDirectory, line)),
      );
      const written = chosen
        .filter((state) => printed.has(resolvePath(state.guide)))
        .map((state) => state.guide);
      if (written.length === 0) return { outcome: 'failed', report: run.err };
      return {
        outcome: 'written',
        written: written.map((path) => relative(briefDirectory, path)),
        report: run.err,
        open: await open(written, briefDirectory),
      };
    },
  };
}
