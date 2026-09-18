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
  /**
   * The artwork on screen is older than the brief being typed (E9.13).
   *
   * A state of the preview and not a second error message: the problems panel already lists
   * what is wrong, and this says only that the picture and the text have stopped agreeing.
   * It has to read well with that panel closed, which is the case the card is about.
   */
  readonly 'preview.stale': string;
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

  /**
   * The document tabs (E9.11).
   *
   * `document.close` titles the × on a tab and reads out for it. The four `document.discard.*`
   * are the question asked before a tab with unsaved text goes away: the renderer translates
   * all four and hands them to main, because the OS draws the dialog and the window owns
   * every string in it (`shared/ipc.ts`).
   */
  readonly 'document.close': string;
  readonly 'document.discard.message': string;
  readonly 'document.discard.detail': string;
  readonly 'document.discard.confirm': string;
  readonly 'document.discard.cancel': string;
  readonly 'command.document.close': string;
  readonly 'command.document.next': string;
  readonly 'command.document.previous': string;
  /** A prefix: the tab's own name follows it, the way a recent entry's does. */
  readonly 'command.document.select': string;

  /**
   * The dock, its panels and the commands that show and hide them (E9.10).
   *
   * `panel.*` are the panel names a command bar entry reads — "Mostrar ou esconder:
   * Problemas" — and they are separate from `editor.heading` and friends on purpose: a
   * heading sits over a pane and names what is in it, and this names the panel itself in a
   * list of panels. They happen to read the same today and will not once a panel's heading
   * carries a file name.
   */
  readonly 'panel.close': string;
  readonly 'command.layout.togglePanel': string;
  readonly 'command.layout.restore': string;
  readonly 'panel.editor': string;
  readonly 'panel.preview': string;
  readonly 'panel.problems': string;

  /**
   * The find-and-replace panel (E8.5), which is CodeMirror's own DOM.
   *
   * These are the only strings in the catalogue that never reach the screen through this
   * app's markup. `@codemirror/search` renders all seventeen through `EditorState.phrases`,
   * and `@tyto/editor` takes them as an option — so the words are still the catalogue's and
   * the panel is still CodeMirror's. `src/renderer/search-phrases.ts` is the mapping, and
   * `packages/editor/src/search.test.ts` is what holds the panel to a locale, because
   * `e2e/window.desktop.test.ts` counts `[data-i18n]` elements and cannot see any of them.
   *
   * The last four are not on the panel: two are read out when the selection moves to a
   * match, and the two with `$` are announced after a replace — the `$` is CodeMirror's own
   * placeholder for the line number or the count, and has to survive translation.
   */
  readonly 'search.find': string;
  readonly 'search.replace': string;
  readonly 'search.next': string;
  readonly 'search.previous': string;
  readonly 'search.all': string;
  readonly 'search.matchCase': string;
  readonly 'search.regexp': string;
  readonly 'search.byWord': string;
  readonly 'search.replaceOne': string;
  readonly 'search.replaceAll': string;
  readonly 'search.close': string;
  readonly 'search.gotoLine': string;
  readonly 'search.go': string;
  readonly 'search.currentMatch': string;
  readonly 'search.onLine': string;
  readonly 'search.replacedOnLine': string;
  readonly 'search.replacedCount': string;

  /** The six commands the search panel brings, for the command bar. */
  readonly 'command.editor.find': string;
  readonly 'command.editor.findNext': string;
  readonly 'command.editor.findPrevious': string;
  readonly 'command.editor.replaceNext': string;
  readonly 'command.editor.replaceAll': string;
  readonly 'command.editor.gotoLine': string;

  readonly 'shell.language.label': string;
  readonly 'shell.about.version': string;
  readonly 'shell.about.platform': string;
  readonly 'shell.about.templates': string;

  /** The export dialog (E9.4). */
  readonly 'export.heading': string;
  readonly 'export.destination': string;
  readonly 'export.destination.choose': string;
  readonly 'export.destination.none': string;
  readonly 'export.fileTypes': string;
  readonly 'export.formats': string;
  readonly 'export.formats.all': string;
  readonly 'export.quality': string;
  readonly 'export.scale': string;
  readonly 'export.start': string;
  readonly 'export.cancel': string;
  readonly 'export.close': string;
  readonly 'export.openFolder': string;
  readonly 'export.progress': string;
  readonly 'export.done': string;
  readonly 'export.cancelled': string;
  readonly 'export.failed': string;
  readonly 'export.problems': string;
  readonly 'command.file.export': string;
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
  'preview.stale',
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
  'document.close',
  'document.discard.message',
  'document.discard.detail',
  'document.discard.confirm',
  'document.discard.cancel',
  'command.document.close',
  'command.document.next',
  'command.document.previous',
  'command.document.select',
  'panel.close',
  'command.layout.togglePanel',
  'command.layout.restore',
  'panel.editor',
  'panel.preview',
  'panel.problems',
  'search.find',
  'search.replace',
  'search.next',
  'search.previous',
  'search.all',
  'search.matchCase',
  'search.regexp',
  'search.byWord',
  'search.replaceOne',
  'search.replaceAll',
  'search.close',
  'search.gotoLine',
  'search.go',
  'search.currentMatch',
  'search.onLine',
  'search.replacedOnLine',
  'search.replacedCount',
  'command.editor.find',
  'command.editor.findNext',
  'command.editor.findPrevious',
  'command.editor.replaceNext',
  'command.editor.replaceAll',
  'command.editor.gotoLine',
  'shell.language.label',
  'shell.about.version',
  'shell.about.platform',
  'shell.about.templates',
  'export.heading',
  'export.destination',
  'export.destination.choose',
  'export.destination.none',
  'export.fileTypes',
  'export.formats',
  'export.formats.all',
  'export.quality',
  'export.scale',
  'export.start',
  'export.cancel',
  'export.close',
  'export.openFolder',
  'export.progress',
  'export.done',
  'export.cancelled',
  'export.failed',
  'export.problems',
  'command.file.export',
] as const satisfies readonly CatalogueKey[];
