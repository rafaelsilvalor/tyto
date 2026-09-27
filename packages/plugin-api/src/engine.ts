import { version } from '../package.json';

/**
 * The version a plugin's `engine` range is checked against (ADR 0040).
 *
 * **This package's version, not the app's.** `apps/cli` and `apps/desktop` are versioned
 * separately — 0.3.1 and 0.5.2 when this was written — so a range checked against the
 * app loading it would mean two different things on one machine. What a plugin is written
 * against is the host contract, and the host contract is this package; both apps load it
 * and both check against this one number.
 *
 * Read from `package.json` at build time rather than written out here, because Changesets
 * bumps that file on every release and a literal would be one release behind the first
 * time nobody remembered it. tsup and Vitest both inline the import; nothing reads a disk at
 * runtime, which is what keeps this package pure (ADR 0010).
 */
export const PLUGIN_API_VERSION: string = version;

type Comparator = '>=' | '<=' | '>' | '<' | '^' | '~' | '=';

interface Bound {
  readonly comparator: Comparator;
  readonly parts: readonly [number, number, number];
  /** How many of the three parts the range actually wrote: `^0.1` is 2, `^0.1.0` is 3. */
  readonly written: number;
}

const BOUND = /^(>=|<=|>|<|\^|~|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

function parseBound(text: string): Bound | undefined {
  const match = BOUND.exec(text.trim());
  if (match === null) return undefined;
  const [, comparator, major, minor, patch] = match;
  return {
    comparator: (comparator ?? '=') as Comparator,
    parts: [Number(major), Number(minor ?? 0), Number(patch ?? 0)],
    written: 1 + (minor === undefined ? 0 : 1) + (patch === undefined ? 0 : 1),
  };
}

/** `0.3.9` and `0.3.9-beta.1` both compare as `0.3.9`; see {@link satisfiesEngine}. */
function parseVersion(text: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The first version a caret or tilde range no longer admits. */
function ceiling(bound: Bound): readonly [number, number, number] {
  const [major, minor, patch] = bound.parts;
  if (bound.comparator === '~') {
    // `~1.2.3` and `~1.2` stay inside 1.2; `~1` stays inside 1.
    return bound.written === 1 ? [major + 1, 0, 0] : [major, minor + 1, 0];
  }
  // Caret: the leftmost non-zero part is the one that may not move, as npm defines it.
  if (major > 0 || bound.written === 1) return [major + 1, 0, 0];
  if (minor > 0 || bound.written === 2) return [0, minor + 1, 0];
  return [0, 0, patch + 1];
}

function admits(bound: Bound, version: readonly [number, number, number]): boolean {
  const order = compare(version, bound.parts);
  switch (bound.comparator) {
    case '>=':
      return order >= 0;
    case '<=':
      return order <= 0;
    case '>':
      return order > 0;
    case '<':
      return order < 0;
    case '=':
      // `=1.2` is every 1.2.x, the way npm reads a partial version.
      return bound.written === 3
        ? order === 0
        : compare(version.slice(0, bound.written), bound.parts.slice(0, bound.written)) === 0;
    case '^':
    case '~':
      return order >= 0 && compare(version, ceiling(bound)) < 0;
  }
}

/**
 * Whether `version` is inside `range`, for the ranges `pluginManifestSchema` accepts.
 *
 * Written here rather than taken from `semver`, because the manifest schema already
 * narrows a range to one comparator per alternative — `>=0.1`, `^1.2.3`, `>=0.1 || ^1` —
 * and those seven comparators are forty lines, where a dependency would be the first one
 * this pure package takes on for something it can say itself.
 *
 * **A prerelease host counts as its release.** `0.4.0-beta.1` satisfies `>=0.4`, which npm
 * would refuse; a plugin author writing against the next API has no way to name a beta
 * they have never seen, and refusing them would make every prerelease of Tyto a release no
 * plugin can load into.
 *
 * A range the schema would have refused answers `false`, never throws: this is called on
 * a file somebody else wrote, and a malformed one is a plugin that does not load.
 */
export function satisfiesEngine(range: string, version: string): boolean {
  const host = parseVersion(version);
  if (host === undefined) return false;

  return range.split('||').some((alternative) => {
    const bound = parseBound(alternative);
    return bound !== undefined && admits(bound, host);
  });
}
