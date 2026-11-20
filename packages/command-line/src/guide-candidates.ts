import { dirname, isAbsolute, join } from 'node:path';

import {
  type BriefAst,
  type RichText,
  type SourceRange,
  type TemplateManifest,
  externalArtVariant,
} from '@tyto/core';

/**
 * Which guides a brief has, where each one goes and when an existing one may be replaced
 * (TYTO-741, ADR 0222). Decided here once, for `tyto guide` and for the window (whose main
 * process imports this package), so the two never name a guide differently.
 *
 * Nothing here reads the disk: a caller hands in what exists and how old it is.
 */

/** Reserved frontmatter keys: metadata about the brief, not slots (core's `resolve` skips the same). */
const RESERVED_KEYS = new Set(['template', 'formats']);

/** What every guide file name ends in: `grafico.guide.psd`, `grafico.story.guide.psd`. */
const GUIDE_SUFFIX = '.guide.psd';

/** One place the brief cites a file for an external slot. */
export interface GuideCandidate {
  readonly slot: string;
  readonly kind: 'full' | 'inline';
  /** The reference as the brief wrote it. */
  readonly cited: string;
  /** Where the brief cites it: the frontmatter key or the directive. */
  readonly range: SourceRange;
  /** The occurrence of the repeatable slot it belongs to, from 1; 1 outside a repeating brief. */
  readonly artwork: number;
}

/** An external slot the brief writes no file for: nothing to name a guide after. */
export interface UncitedSlot {
  readonly slot: string;
  readonly kind: 'full' | 'inline';
  /** The line that cites a file for it, as a person would add it to the brief. */
  readonly line: string;
}

/** A citation that gets no guide, and why. */
export interface UnguidedCitation {
  readonly slot: string;
  readonly cited: string;
  readonly range: SourceRange;
  readonly reason: string;
}

export interface GuideCandidates {
  readonly candidates: readonly GuideCandidate[];
  /** External slots the template declares and the brief does not cite; never generated. */
  readonly uncited: readonly UncitedSlot[];
  readonly unguided: readonly UnguidedCitation[];
}

function plain(text: RichText): string {
  return text
    .map((inline) => {
      switch (inline.kind) {
        case 'text':
          return inline.value;
        case 'break':
          return '\n';
        default:
          return plain(inline.children);
      }
    })
    .join('');
}

/** A URI scheme names an item in a plugin's source (ADR 0117), which `externalArtVariant` refuses too. */
function isPluginItem(reference: string): boolean {
  return externalArtVariant(reference, 'probe') === undefined;
}

/**
 * The external slots `ast` cites a file for, one per occurrence, in the order written.
 *
 * Only the first `full` slot's art is the frame's (ADR 0220's note), so a second one is listed
 * as unguided rather than given a PSD nothing writes. A plugin directive's slots are not read:
 * the brief's text cites no file for them.
 */
export function guideCandidates(ast: BriefAst, manifest: TemplateManifest): GuideCandidates {
  const external = Object.entries(manifest.slots).filter(([, slot]) => slot.external !== undefined);
  const frameSlot = external.find(([, slot]) => slot.external?.kind === 'full')?.[0];
  const repeatable = Object.entries(manifest.slots).find(([, slot]) => slot.repeat)?.[0];

  const cited: { slot: string; reference: string; range: SourceRange; artwork: number }[] = [];
  for (const [key, value] of Object.entries(ast.frontmatter.data)) {
    if (RESERVED_KEYS.has(key) || manifest.slots[key]?.external === undefined) continue;
    const range = ast.frontmatter.ranges[key] ?? ast.frontmatter.range ?? ast.range;
    cited.push({ slot: key, reference: String(value).trim(), range, artwork: 1 });
  }
  let occurrence = 0;
  for (const directive of ast.directives) {
    if (directive.namespace !== undefined) continue;
    if (directive.name === repeatable) occurrence += 1;
    if (manifest.slots[directive.name]?.external === undefined) continue;
    cited.push({
      slot: directive.name,
      reference: plain(directive.body).trim(),
      range: directive.range,
      artwork: Math.max(occurrence, 1),
    });
  }

  const candidates: GuideCandidate[] = [];
  const unguided: UnguidedCitation[] = [];
  for (const { slot, reference, range, artwork } of cited) {
    const kind = manifest.slots[slot]?.external?.kind ?? 'inline';
    const refuse = (reason: string): void => {
      unguided.push({ slot, cited: reference, range, reason });
    };
    if (reference === '') refuse('the brief names no file for it');
    else if (isPluginItem(reference)) refuse("it names an item in a plugin's source, not a file");
    else if (kind === 'full' && slot !== frameSlot) {
      refuse(`only the first full slot, '${frameSlot ?? ''}', is the frame's art (ADR 0220)`);
    } else candidates.push({ slot, kind, cited: reference, range, artwork });
  }

  const named = new Set(cited.map((entry) => entry.slot));
  const uncited = external
    .filter(([name]) => !named.has(name))
    .map(([name, slot]) => ({
      slot: name,
      kind: slot.external?.kind ?? 'inline',
      line:
        slot.per === undefined && !slot.repeat
          ? `${name}: ${name}.png`
          : `::${name}\n  ${name}.png`,
    }));
  return { candidates, uncited, unguided };
}

/** One guide file, and the PNG painted from it that the brief reads back. */
export interface GuideTarget {
  readonly slot: string;
  readonly kind: 'full' | 'inline';
  readonly cited: string;
  /** The format this guide is drawn at. */
  readonly format: string;
  /** Absolute. */
  readonly guide: string;
  /** Absolute: the cited file for one format, its `<stem>.<format>` copy for several. */
  readonly art: string;
}

export interface GuideLocation {
  /** Absolute. */
  readonly briefDirectory: string;
  /**
   * The brief is a delivery's (its folder is the delivery's editable one), whose `assets/`
   * sits beside that folder: where a delivery keeps its pictures (ADR 0161).
   */
  readonly delivery: boolean;
  /** Whether a file is there: the folder the cited file is found in earliest wins. */
  readonly exists: (path: string) => boolean;
}

/** The folders asked before a project's stock ones, in the asset resolver's order; the last is the default. */
export function guideFolders(
  location: Pick<GuideLocation, 'briefDirectory' | 'delivery'>,
): string[] {
  const own = join(location.briefDirectory, 'assets');
  return location.delivery
    ? [location.briefDirectory, own, join(location.briefDirectory, '..', 'assets')]
    : [location.briefDirectory, own];
}

/**
 * The folder a cited file's guide goes in (ADR 0222, decision 3): beside the cited file when
 * it is already in one of the brief's own folders, else in the default `assets/`. A project's
 * stock folders come later in the search order and are never written to. An absolute
 * reference names its own folder.
 */
function folderOf(cited: string, location: GuideLocation): string {
  if (isAbsolute(cited)) return dirname(cited);
  const folders = guideFolders(location);
  const found = folders.find((folder) => location.exists(join(folder, cited)));
  return dirname(join(found ?? folders[folders.length - 1] ?? location.briefDirectory, cited));
}

function fileName(reference: string): string {
  return reference.slice(Math.max(reference.lastIndexOf('/'), reference.lastIndexOf('\\')) + 1);
}

/** `grafico.png` → `grafico`; a hidden file's leading dot is its name, not an extension. */
function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * The guides of one candidate (ADR 0222, decision 2): `grafico.guide.psd` beside a cited
 * `grafico.png` for one format, `grafico.<format>.guide.psd` per format for several, whose
 * PNG is expected back at `grafico.<format>.png`.
 */
export function guidePaths(
  candidate: Pick<GuideCandidate, 'slot' | 'kind' | 'cited'>,
  formats: readonly string[],
  location: GuideLocation,
): GuideTarget[] {
  const folder = folderOf(candidate.cited, location);
  const name = fileName(candidate.cited);
  const stem = stemOf(name);
  return formats.map((format) => {
    const single = formats.length === 1;
    const art = single ? name : (externalArtVariant(name, format) ?? name);
    return {
      slot: candidate.slot,
      kind: candidate.kind,
      cited: candidate.cited,
      format,
      guide: join(folder, single ? `${stem}${GUIDE_SUFFIX}` : `${stem}.${format}${GUIDE_SUFFIX}`),
      art: join(folder, art),
    };
  });
}

/** What happens to a guide file about to be written. */
export type GuideOverwrite = 'write' | 'ask' | 'refuse';

/**
 * ADR 0222, decision 4: no guide, or one no newer than the brief, is written; a newer one may
 * hold the designer's paint, so the window asks and the command line refuses unless forced.
 */
export function guideOverwrite(input: {
  /** Milliseconds; absent when there is no guide yet. */
  readonly guideModified?: number;
  readonly briefModified: number;
  readonly force: boolean;
  readonly interactive: boolean;
}): GuideOverwrite {
  if (input.guideModified === undefined || input.force) return 'write';
  if (input.guideModified <= input.briefModified) return 'write';
  return input.interactive ? 'ask' : 'refuse';
}
