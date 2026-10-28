/**
 * A change to the isolation protocol is a breaking release of `@tyto/plugin-api` (ADR 0149).
 *
 * `RPC_PROTOCOL_VERSION` is the number a host and an isolated plugin compare in `hello`, and a
 * guest on another number is refused before any other message is read. Once the contract is
 * published, the plugin's repository holds a range such as `^0.4.1` — and on 0.x a caret
 * range only moves through patches, so a protocol bump released as a patch reaches that
 * plugin through an ordinary update and breaks it. Released as a minor (a major from 1.0), it
 * falls outside the range: the plugin keeps the version it was tested against until somebody
 * moves it on purpose. The engine is this same version (ADR 0040), so a manifest asking for
 * `^0.4` is refused by the new host for the same reason, rather than loaded and then refused.
 *
 * `changeset-coverage.mjs` asks this question with what it already read from git.
 */

export const PLUGIN_API = '@tyto/plugin-api';

export const PROTOCOL_FILE = 'packages/plugin-api/src/isolation/protocol.ts';

/** @param {string | undefined} source the protocol file at one revision */
export function protocolVersionOf(source) {
  if (source === undefined) return undefined;
  const found = /export const RPC_PROTOCOL_VERSION\s*=\s*(\d+)\s*;/u.exec(source);
  return found === null ? undefined : Number(found[1]);
}

/**
 * The bump a protocol change needs, from the version the package has before it: a minor on
 * 0.x, where a minor is what a caret range refuses, and a major from 1.0.
 *
 * @param {string} version
 * @returns {'minor' | 'major'}
 */
export const breakingBumpFor = (version) => (version.startsWith('0.') ? 'minor' : 'major');

const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

/**
 * @param {{
 *   before: number | undefined,
 *   after: number | undefined,
 *   version: string,
 *   addedChangesets: { bumps: Record<string, string> }[],
 * }} input
 * @returns {{ ok: boolean, message: string }}
 */
export function protocolBumpVerdict({ before, after, version, addedChangesets }) {
  if (before === after) {
    return { ok: true, message: `RPC_PROTOCOL_VERSION unchanged (${after})` };
  }
  const needed = breakingBumpFor(version);
  const given = addedChangesets
    .map(({ bumps }) => bumps[PLUGIN_API])
    .filter((bump) => bump !== undefined)
    .sort((left, right) => (RANK[right] ?? 0) - (RANK[left] ?? 0))[0];

  if (given !== undefined && (RANK[given] ?? 0) >= RANK[needed]) {
    return {
      ok: true,
      message: `RPC_PROTOCOL_VERSION ${before} → ${after}, released as a ${given} of ${PLUGIN_API}`,
    };
  }
  return {
    ok: false,
    message: [
      `RPC_PROTOCOL_VERSION ${before} → ${after}, but this branch releases ${PLUGIN_API} ${version} as ${given === undefined ? 'nothing' : `a ${given}`}.`,
      `A protocol change is breaking for every installed plugin: add a changeset with '${PLUGIN_API}': ${needed}.`,
      'ADR 0149 has why.',
    ].join('\n'),
  };
}
