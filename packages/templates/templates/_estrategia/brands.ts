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
 * A separate shape from {@link Brand} because the table signs off with the account's handle
 * on every brand, EC included, where EC's story agenda signs off with a note.
 */
export interface TableBrand {
  /** The owl, the title, the header row and a band. */
  readonly accent: string;
  /** The words at the foot. */
  readonly handle: string;
}

/**
 * Estratégia Concursos's table.
 *
 * **Provisional accent, declared:** `#5B0DBF` is the purple of the art the maintainer approved
 * for MCA-66477 (his standalone generator's "roxo"), and not {@link EC}'s `#5900a6`, which the
 * mock-exam agenda draws. Which one is EC's purple is his call, asked on 2026-10-02; the
 * answer is a change to this one line.
 */
export const EC_TABLE: TableBrand = {
  accent: '#5B0DBF',
  handle: '@estrategiaconcursos',
};
