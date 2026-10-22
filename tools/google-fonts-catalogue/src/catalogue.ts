/**
 * The Google Fonts catalogue `@tyto/google-fonts` ships, built from two public sources
 * (TYTO-281, ADR 0120). Pure, so the shape is tested without a network; `generate.ts` does
 * the fetching.
 *
 * - `https://fonts.google.com/metadata/fonts`: every family Google serves, its category and
 *   the styles it has (`400`, `700i`…). It carries no licence.
 * - `github.com/google/fonts`: each family is a folder under the licence it ships with —
 *   `ofl/`, `apache/` or `ufl/` — named by the family in lower case with nothing but letters
 *   and digits. That folder is where the licence is read from.
 *
 * A family the metadata lists and no licence folder holds is left out: Tyto fetches only what
 * it can say the licence of.
 */

export type Licence = 'ofl' | 'apache' | 'ufl';

/** One family as the package reads it: `styles` is Google's own spelling, space-separated. */
export interface CatalogueFamily {
  readonly family: string;
  readonly category: string;
  readonly licence: Licence;
  readonly styles: string;
}

export interface Catalogue {
  /** The day the sources were read, so a stale snapshot is visible in the file itself. */
  readonly generated: string;
  readonly families: readonly CatalogueFamily[];
}

/** What the metadata endpoint answers, as far as the catalogue reads it. */
export interface GoogleMetadata {
  readonly familyMetadataList: readonly {
    readonly family: string;
    readonly category: string;
    readonly fonts: Readonly<Record<string, unknown>>;
  }[];
}

/** The repository's folder name for a family: `Source Sans 3` is `sourcesans3`. */
export function folderOf(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

/** `100 < 100i < 400 < 700 < 700i`: by weight, then upright before italic. */
function styleOrder(a: string, b: string): number {
  return Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.length - b.length;
}

export function buildCatalogue(
  metadata: GoogleMetadata,
  licences: ReadonlyMap<string, Licence>,
  generated: string,
): { readonly catalogue: Catalogue; readonly unlicensed: readonly string[] } {
  const families: CatalogueFamily[] = [];
  const unlicensed: string[] = [];
  for (const entry of metadata.familyMetadataList) {
    const licence = licences.get(folderOf(entry.family));
    if (licence === undefined) {
      unlicensed.push(entry.family);
      continue;
    }
    const styles = Object.keys(entry.fonts)
      .filter((style) => /^[1-9]00i?$/u.test(style))
      .sort(styleOrder)
      .join(' ');
    if (styles === '') continue;
    families.push({ family: entry.family, category: entry.category, licence, styles });
  }
  families.sort((a, b) => a.family.localeCompare(b.family, 'en'));
  return { catalogue: { generated, families }, unlicensed };
}

/**
 * One family per line: the file is data a person may want to read in a diff, and 1,900
 * families pretty-printed one key per line would be ten thousand lines of noise.
 */
export function serialiseCatalogue(catalogue: Catalogue): string {
  const lines = catalogue.families.map((family) => `    ${JSON.stringify(family)}`);
  return `{\n  "generated": ${JSON.stringify(catalogue.generated)},\n  "families": [\n${lines.join(',\n')}\n  ]\n}\n`;
}
