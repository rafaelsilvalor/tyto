/**
 * The strings the app shows a person, and the only place any of them is written.
 *
 * `docs/conventions.md`: everything in the repo is English except what a user reads, and
 * what a user reads lives here with `pt-BR` first and `en` as the fallback. First and not
 * "default" — the maintainer and the first users work in Portuguese, so Portuguese is the
 * locale that is complete by construction and English is the one that catches a key added
 * in a hurry.
 *
 * The catalogue is a type rather than a convention, so a locale missing a key does not
 * compile. That is the half of "no hardcoded UI strings" a lint cannot do: forbidding a
 * literal in a template is easy, and noticing that a translation was never written is not.
 */

/** Every key the app can show. Adding one here makes every locale below fail to compile. */
export interface Catalogue {
  readonly 'app.name': string;
  readonly 'app.tagline': string;
  readonly 'editor.heading': string;
  readonly 'preview.heading': string;
  readonly 'preview.slide.label': string;
  readonly 'preview.zoom.out': string;
  readonly 'preview.zoom.in': string;
  readonly 'preview.zoom.fit': string;
  /** Shown in place of a frame while the brief produces none. */
  readonly 'preview.empty': string;
  /** The status line under the stage, with the number of problems spliced in. */
  readonly 'preview.problems': string;
  readonly 'preview.ok': string;
  readonly 'shell.language.label': string;
  readonly 'shell.about.version': string;
  readonly 'shell.about.platform': string;
  readonly 'shell.about.templates': string;
}

export type CatalogueKey = keyof Catalogue;

export const CATALOGUE_KEYS = [
  'app.name',
  'app.tagline',
  'editor.heading',
  'preview.heading',
  'preview.slide.label',
  'preview.zoom.out',
  'preview.zoom.in',
  'preview.zoom.fit',
  'preview.empty',
  'preview.problems',
  'preview.ok',
  'shell.language.label',
  'shell.about.version',
  'shell.about.platform',
  'shell.about.templates',
] as const satisfies readonly CatalogueKey[];
