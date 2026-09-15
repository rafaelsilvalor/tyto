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
  /** The bottom panel that lists what the stages had to say about the brief. */
  readonly 'problems.heading': string;
  readonly 'problems.empty': string;
  /** Read out for the coloured dot in front of a diagnostic, which says nothing on its own. */
  readonly 'problems.severity.error': string;
  readonly 'problems.severity.warning': string;
  readonly 'problems.severity.info': string;
  /** Titles the `line:column` a diagnostic points at. */
  readonly 'problems.location': string;
  /** A diagnostic about the project rather than about a span of the brief. */
  readonly 'problems.nowhere': string;
  readonly 'template.label': string;
  /** The option standing for a brief whose frontmatter names no template yet. */
  readonly 'template.none': string;
  /**
   * The command bar (E9.12), and the labels of everything it lists.
   *
   * A command's label is a catalogue key here rather than the `label` on the `EditorCommand`
   * itself: `@tyto/editor` is a package with no locale, its two built-in commands carry
   * English labels, and a registry that had to be re-registered to change language would be
   * the wrong shape. `COMMAND_LABELS` in `src/renderer/commands.ts` is the map.
   */
  readonly 'command.bar.placeholder': string;
  readonly 'command.bar.empty': string;
  readonly 'command.undo': string;
  readonly 'command.redo': string;
  readonly 'command.preview.zoomIn': string;
  readonly 'command.preview.zoomOut': string;
  readonly 'command.preview.zoomFit': string;
  readonly 'command.preview.nextFormat': string;
  readonly 'command.preview.previousFormat': string;
  readonly 'command.preview.nextSlide': string;
  readonly 'command.preview.previousSlide': string;
  readonly 'command.shell.toggleLocale': string;
  readonly 'command.editor.toggleVim': string;

  /**
   * Opening, saving and the recent list (E9.8).
   *
   * `command.file.recent` is a prefix and not a whole label: a recent entry reads
   * "Recente: campanha.brief", because the file's own name is not the catalogue's to
   * translate and a row that was only a file name would be unfindable by typing "recente".
   * `document.untitled` and `document.unsaved` are what the window title is built from.
   * `file.missing` is a diagnostic the desktop raises itself, shown in the problems panel
   * beside the ones the compiler produced.
   */
  readonly 'command.file.open': string;
  readonly 'command.file.save': string;
  readonly 'command.file.saveAs': string;
  readonly 'command.file.recent': string;
  readonly 'document.untitled': string;
  readonly 'document.unsaved': string;
  readonly 'file.missing': string;

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
  'problems.heading',
  'problems.empty',
  'problems.severity.error',
  'problems.severity.warning',
  'problems.severity.info',
  'problems.location',
  'problems.nowhere',
  'template.label',
  'template.none',
  'command.bar.placeholder',
  'command.bar.empty',
  'command.undo',
  'command.redo',
  'command.preview.zoomIn',
  'command.preview.zoomOut',
  'command.preview.zoomFit',
  'command.preview.nextFormat',
  'command.preview.previousFormat',
  'command.preview.nextSlide',
  'command.preview.previousSlide',
  'command.shell.toggleLocale',
  'command.editor.toggleVim',
  'command.file.open',
  'command.file.save',
  'command.file.saveAs',
  'command.file.recent',
  'document.untitled',
  'document.unsaved',
  'file.missing',
  'shell.language.label',
  'shell.about.version',
  'shell.about.platform',
  'shell.about.templates',
] as const satisfies readonly CatalogueKey[];
