/**
 * One part of a file name, safe on every file system a delivery or a workspace lands on
 * (ADR 0053, ADR 0172).
 *
 * An accented Latin letter keeps its base letter (`Matemática` → `Matematica`), because the
 * people who name rows and formats write Portuguese and a name read back from a folder listing
 * should still be the word they wrote. Anything else a file system or a URL would argue about
 * is collapsed to `-`, and leading dots and dashes go too: `.slide` would be a hidden file on
 * Unix, and a file nobody can see in a folder listing is a file nobody knows was produced.
 *
 * Windows refuses two more things, and the team works on Windows: a name ending in a dot or a
 * space, which is dropped, and a reserved device name (`CON`, `NUL`, `COM1`…, in any case and
 * with any extension), whose stem gets a `_`. A part that sanitises away is `untitled`, never
 * an empty name.
 *
 * Written once, here, for every caller that names a file after what a person wrote: the
 * pipeline names an artwork after its format, and the recipe's `to-brief` names a brief after
 * a column. Two callers that sanitised differently would answer "which file is this?" two ways.
 */
export function fileSafeName(part: string): string {
  const safe =
    transliterate(part)
      .replace(TRAILING, '')
      .replace(UNSAFE, '-')
      .replace(/^[.-]+/u, '') || 'untitled';
  return safe.replace(RESERVED, '$1_$2');
}

/** Accented Latin letters to their base letter; every other character is left to `UNSAFE`. */
function transliterate(part: string): string {
  return part
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(LIGATURES, (letter) => LIGATURE_SPELLING[letter] ?? letter);
}

/** Latin letters that no canonical decomposition reaches. */
const LIGATURE_SPELLING: Readonly<Record<string, string>> = {
  ß: 'ss',
  ẞ: 'SS',
  æ: 'ae',
  Æ: 'AE',
  ø: 'o',
  Ø: 'O',
  œ: 'oe',
  Œ: 'OE',
  đ: 'd',
  Đ: 'D',
  ł: 'l',
  Ł: 'L',
};

const LIGATURES = /[ßẞæÆøØœŒđĐłŁ]/gu;

const TRAILING = /[. ]+$/u;

const UNSAFE = /[^a-zA-Z0-9._-]+/gu;

/** Windows device names: the stem before the first dot is what Windows compares. */
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/iu;
