/**
 * "Did you mean …?" — the one piece of guesswork the diagnostics are allowed.
 *
 * Every stage that checks a name against a declared list wants it: `resolve` against a
 * manifest's slots, `template-lang` against the accepted tags, attributes and CSS
 * properties. It lives here rather than in each of them because the budget below is the
 * part that has to be the same everywhere — a suggestion that is wrong is worse than no
 * suggestion, and two copies of it would drift.
 */

/** Levenshtein distance, capped by the shorter word — enough for a "did you mean". */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1);
    }
    previous = current;
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

/**
 * The declared name closest to what the author wrote, if one is close enough to be a typo.
 *
 * A third of the word is the budget: `titulo`/`titlo` is a typo, `titulo`/`rodape` is a
 * different slot, and suggesting the second would be worse than suggesting nothing.
 */
export function didYouMean(written: string, candidates: readonly string[]): string | undefined {
  const budget = Math.max(1, Math.floor(written.length / 3));
  let best: { name: string; distance: number } | undefined;
  for (const name of candidates) {
    const distance = editDistance(written.toLowerCase(), name.toLowerCase());
    if (distance <= budget && (best === undefined || distance < best.distance)) {
      best = { name, distance };
    }
  }
  return best?.name;
}
