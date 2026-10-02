/**
 * What sets the three brands of the weekly mock-exam agenda apart (TYTO-200): an accent and a
 * sign-off. Everything else is in `tokens.ts`, shared.
 *
 * The accents are the maintainer's, given as hex on 2026-09-28. The handles are read off his
 * references; EC's story signs off with a line pointing at the story's link instead, and EC
 * has no grid at all, which its manifest says rather than this file.
 */

export interface Brand {
  /** The colour of the day, the band, the owl, the call to comment and the sign-off. */
  readonly accent: string;
  /** What the bottom area says: the account's handle, or a line of its own. */
  readonly signOff: { readonly kind: 'handle' | 'note'; readonly text: string };
}

/** Estratégia Carreira Jurídica — the reference the maintainer drew the piece on. */
export const ECJ: Brand = {
  accent: '#c37d2c',
  signOff: { kind: 'handle', text: '@estrategiacarreirajuridica' },
};

/** Estratégia OAB. */
export const OAB: Brand = {
  accent: '#88002e',
  signOff: { kind: 'handle', text: '@estrategiaoab' },
};

/** Estratégia Concursos: stories only, and a note to the story's link in place of a handle. */
export const EC: Brand = {
  accent: '#5900a6',
  signOff: { kind: 'note', text: 'Clique no link para mais informações' },
};

/**
 * The grid's call to comment when the brief writes no `chamada` (the maintainer, 2026-09-29:
 * a field with a default). The default lives here and not in the manifests, because a
 * manifest `default` is only applied to an `enum` slot.
 */
export const CALL_TO_COMMENT = 'Escreva SIMULADO nos comentários para acessar';

/**
 * What sets one brand's one-image table apart (TYTO-218): its accent and its handle.
 *
 * A separate shape from {@link Brand} only for the handle: the table signs off with the
 * account's handle on every brand, EC included, where EC's story agenda signs off with a
 * note. The accent is the brand's own, read from its {@link Brand}.
 */
export interface TableBrand {
  /** The owl, the title, the header row and a band. */
  readonly accent: string;
  /** The words at the foot. */
  readonly handle: string;
}

/**
 * Estratégia Concursos's table: EC's registered accent, the one the mock-exam agenda draws, and
 * its handle.
 *
 * The approved MCA-66477 art was drawn in `#5B0DBF`, the maintainer's standalone generator's
 * purple; he chose the registered brand colour instead (2026-10-02), so one brand keeps one
 * accent and a render sits a shade apart from that reference on purpose.
 */
export const EC_TABLE: TableBrand = {
  accent: EC.accent,
  handle: '@estrategiaconcursos',
};
