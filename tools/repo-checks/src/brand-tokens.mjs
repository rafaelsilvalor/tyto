/**
 * Finds known brand tokens in the tracked text files without the repository holding the
 * tokens themselves (ADR 0065).
 *
 * The list in `brand-token-hashes.json` is SHA-256 digests of normalised tokens: a handle, a
 * compound brand name, a subpath of a logo's path data. A file is read the same way the list
 * was made — every word, every pair of adjacent words, every subpath of every run of path
 * data — and each piece is hashed and looked up. A hit names the file, the line and the kind,
 * and never the token, so the failure message does not put back what the check keeps out.
 *
 * **A digest hides a token from a search, not from a guess.** A short token's digest is
 * brute-forced in seconds. What the list buys is that no plain copy sits in the tree for a
 * reader or an indexer to find; it is not a secret.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A run of path data shorter than this is not looked at: a rectangle, an arrow head. */
export const PATH_MINIMUM = 40;

/** How many bytes are read to decide that a file is binary, as git itself does. */
const BINARY_PROBE = 8000;

/** The digest every token is compared by. */
export function digest(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Words, lower case and without accents, each with the line it starts on.
 *
 * camelCase is split before lowering, so an identifier built from a brand name is read as the
 * words it was built from. Anything that is not a letter or a digit separates words, so a
 * handle's dot or a template name's hyphen does too.
 */
export function wordsOf(text) {
  const plain = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
  const words = [];
  let line = 1;
  let scanned = 0;
  for (const match of plain.matchAll(/[a-z0-9]+/g)) {
    line += countNewlines(plain, scanned, match.index);
    scanned = match.index;
    words.push({ word: match[0], line });
  }
  return words;
}

/** Each word, and each pair of adjacent words joined by one space, with its line. */
export function wordTokensOf(text) {
  const words = wordsOf(text);
  const tokens = words.map(({ word, line }) => ({ token: word, line }));
  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1];
    tokens.push({ token: `${previous.word} ${words[index].word}`, line: previous.line });
  }
  return tokens;
}

/**
 * Every subpath of every run of path data at least {@link PATH_MINIMUM} characters long, each
 * normalised and with its line.
 *
 * A run is a stretch of path commands, digits and separators; it is cut into subpaths before
 * each `M`/`m`, so a logo joined into one `d`, split across string literals or pasted from an
 * SVG file yields the same subpaths. Normalising makes one separator of any run of commas and
 * spaces, and none beside a command letter, which is how two exporters most often differ.
 */
export function pathTokensOf(text) {
  const tokens = [];
  const lines = text.split('\n');
  lines.forEach((content, index) => {
    for (const match of content.matchAll(/[MmLlHhVvCcSsQqTtAaZz0-9.,\- \t]+/g)) {
      if (match[0].length < PATH_MINIMUM || !/\d/.test(match[0])) continue;
      for (const subpath of subpathsOf(match[0])) tokens.push({ token: subpath, line: index + 1 });
    }
  });
  return tokens;
}

/** A `d`, cut before each move command and normalised; the short pieces dropped. */
export function subpathsOf(pathData) {
  return pathData
    .split(/(?=[Mm])/)
    .map(normalisePath)
    .filter((subpath) => subpath.length >= PATH_MINIMUM);
}

function normalisePath(subpath) {
  return subpath
    .trim()
    .replace(/[\s,]+/g, ',')
    .replace(/,?([A-Za-z]),?/g, '$1');
}

/**
 * The hits in one file's text: `{ line, kind }` for each token whose digest is listed.
 *
 * `hashes` maps a digest to the kind the list gives it — `word` or `path`. `seen` remembers
 * each token's answer, so a scan of many files hashes each distinct token once: a repository's
 * words repeat, and hashing every occurrence took over a minute on a loaded machine.
 */
export function findIn(text, hashes, seen = new Map()) {
  const hits = [];
  for (const { token, line } of [...wordTokensOf(text), ...pathTokensOf(text)]) {
    let kind = seen.get(token);
    if (kind === undefined) {
      kind = hashes.get(digest(token)) ?? null;
      seen.set(token, kind);
    }
    if (kind !== null) hits.push({ line, kind });
  }
  return hits;
}

/** The listed digests, keyed to their kind. */
export function loadHashes(file) {
  const list = JSON.parse(readFileSync(file, 'utf8'));
  return new Map(
    Object.entries(list.hashes).flatMap(([kind, digests]) => digests.map((entry) => [entry, kind])),
  );
}

/**
 * Every hit in the tracked text files under `root`, as `path:line (kind)` lines.
 *
 * Tracked files only: what a commit would publish. A binary file is skipped, which is why a
 * logo painted into an image is not something this finds.
 */
export function scanRepository(root, hashes) {
  const listed = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  const found = [];
  const seen = new Map();
  for (const path of listed.split('\0').filter(Boolean)) {
    let bytes;
    try {
      bytes = readFileSync(join(root, path));
    } catch {
      // Listed by git but gone from the working tree: nothing to publish from here.
      continue;
    }
    if (bytes.subarray(0, BINARY_PROBE).includes(0)) continue;
    for (const { line, kind } of findIn(bytes.toString('utf8'), hashes, seen))
      found.push(`${path}:${line} (${kind})`);
  }
  return found;
}

function countNewlines(text, from, to) {
  let count = 0;
  for (let index = from; index < to; index += 1) if (text[index] === '\n') count += 1;
  return count;
}
