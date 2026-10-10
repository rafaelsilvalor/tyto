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
   * The folder of templates this app searches before the built-in pack (TYTO-122).
   *
   * `templates.folder.label` titles the footer row and `templates.folder.none` is what stands
   * in it when nobody has chosen one — a word, not a path, because "internos" reads as a
   * state and an empty cell reads as a bug.
   *
   * `templates.folder.empty` is a diagnostic the window mints itself, the way `file.missing`
   * is: main can tell that a folder produced no templates, but only the renderer knows which
   * language to say it in.
   */
  readonly 'templates.folder.label': string;
  readonly 'templates.folder.none': string;
  readonly 'templates.folder.empty': string;
  readonly 'command.templates.chooseFolder': string;
  readonly 'command.templates.clearFolder': string;
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
   * A save that did not write, shown the way `file.missing` is (TYTO-124).
   *
   * A sentence and not a question: the panel is where *why is this not working* already goes,
   * and a box interrupting on a full disk would be the second interrupting box this window
   * has — the first one, the quit question, is deliberate about being the only one. The file's
   * name and the reason the system gave are appended at the point of use, the way
   * `file.missing` appends the name.
   */
  readonly 'file.saveFailed': string;

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

  /**
   * The question asked about the whole window, on the way out (TYTO-123, TYTO-153).
   *
   * Five strings, drawn through `dialog:save-changes` — main draws the box, the renderer owns
   * every word in it, the same arrangement `document.discard.*` above has.
   *
   * **It used to ask *Sair sem salvar?* and offer two answers, neither of which saved**
   * (TYTO-153). The keys are named for what the box asks now: `confirm` is the button that
   * writes the work, `discard` is the one the old `exit.discard.confirm` was, and `cancel`
   * still returns to the editor.
   *
   * **`{n}` is a placeholder, and it is the first one in this catalogue.** The renderer
   * substitutes the count; nothing here interpolates on its own. Two detail strings and not
   * one because agreement changes on the number in Portuguese — *1 aba tem* against *3 abas
   * têm* — and a single string with a parenthesised plural is the thing a catalogue exists
   * to make unnecessary.
   */
  readonly 'exit.save.message': string;
  readonly 'exit.save.detail.one': string;
  readonly 'exit.save.detail.many': string;
  readonly 'exit.save.confirm': string;
  readonly 'exit.save.discard': string;
  readonly 'exit.save.cancel': string;
  /**
   * The first string this app wrote into the application menu (TYTO-132).
   *
   * Most entries there are an Electron role whose label is the system's, in the system's
   * language — `src/main/menu.ts` says why. This one names a folder that belongs to Tyto, so
   * Electron has no word for it. The File menu below is the other exception, and it is the
   * larger one: Electron has words for *Open* and *Save*, but not for a menu that runs this
   * app's own registry.
   *
   * **It followed the system's language and not the footer picker's, and no longer does.**
   * TYTO-124 gave the menu the way to be told: `app:locale` carries the window's choice to
   * main, which rebuilds the menu in it. The startup locale is still the system's, because
   * that is the only one main has before the window has answered anything.
   */
  readonly 'menu.revealLogs': string;
  /**
   * What a crash in main puts on screen (TYTO-140).
   *
   * Three strings and not one, because the box says three things: that something broke, where
   * the record of it is, and — in the one case where there is no record — that there is none.
   * `crash.noLog` is reached when `fileLog` itself failed, which is a `userData` this app is
   * not allowed to write to; a box naming a folder that was never written would send somebody
   * looking for a file that is not there.
   *
   * The folder's path and the error's own first line are appended at the point of use, the way
   * `file.missing` appends a name. They are not the catalogue's: one is a path and the other
   * is whatever the system said, and neither is translatable.
   *
   * These follow the window's language, not the system's — `app:locale` tells main which one
   * that is (TYTO-124), and the startup locale is the system's because it is the only one main
   * has before the window has answered anything.
   */
  readonly 'crash.title': string;
  readonly 'crash.detail': string;
  readonly 'crash.noLog': string;
  /**
   * The button that dismisses the crash box (TYTO-144). The other button is `menu.revealLogs`,
   * reused rather than copied, because it does exactly what the Help menu item does.
   */
  readonly 'crash.close': string;
  /**
   * The one question a new version asks on its first run (TYTO-151, ADR 0036).
   *
   * `{version}` is the older version's folder name, spliced in at the point of use the way
   * `{n}` is for the quit box. The detail says what comes across and that the older version
   * keeps its copy, because "bring" read alone could mean "move".
   *
   * `import.credentials` is a checkbox of its own, unticked, and shown only when the older
   * version had stored any: copying secrets is a different act from copying a panel width
   * and gets its own sentence.
   */
  readonly 'import.message': string;
  readonly 'import.detail': string;
  readonly 'import.credentials': string;
  readonly 'import.confirm': string;
  readonly 'import.decline': string;
  /**
   * The footer's update notice (TYTO-131, ADR 0069). `{version}` is the newer version.
   * Only one of the three is ever on screen, and none while there is nothing newer.
   */
  readonly 'update.available': string;
  readonly 'update.downloading': string;
  readonly 'update.ready': string;
  /**
   * The File submenu's own title (TYTO-124).
   *
   * Written by this app rather than left to `role: 'fileMenu'`, because that role's entire
   * content on Windows and Linux is Quit — and on macOS it brings *Close Window* on `Mod-W`,
   * which is the accelerator `src/main/menu.ts` exists to keep away from the page.
   */
  readonly 'menu.file': string;
  readonly 'command.document.new': string;
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
  /** TYTO-45. Closed in the default layout, like the panel it names. */
  readonly 'panel.queue': string;

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

  /**
   * The status bar (TYTO-248, ADR 0076). The three area toggles are commands, so their
   * labels are the bar's and the buttons' both; the rest are the bar's own words. `{line}`,
   * `{column}` and `{count}` are placeholders the bar substitutes.
   */
  readonly 'command.layout.toggleDock.left': string;
  readonly 'command.layout.toggleDock.right': string;
  readonly 'command.layout.toggleDock.bottom': string;
  readonly 'status.commandBar': string;
  readonly 'status.position': string;
  readonly 'status.selected': string;
  readonly 'status.kind.settings': string;
  readonly 'status.kind.keybindings': string;
  readonly 'status.problems.new': string;
  /**
   * Help > About, where the version, the platform, the template count and the template
   * folder went when the footer became a status bar (TYTO-248).
   */
  readonly 'menu.about': string;
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
  /** Heads the list of files an earlier export left and this one removed or kept (ADR 0054). */
  readonly 'export.leftovers': string;
  readonly 'command.file.export': string;

  /** The template mode (TYTO-44). */
  readonly 'command.template.edit': string;
  readonly 'command.template.new': string;
  readonly 'templateMode.heading': string;
  readonly 'templateMode.save': string;
  readonly 'templateMode.close': string;
  readonly 'templateMode.openOther': string;
  readonly 'templateMode.example': string;
  readonly 'templateMode.noExample': string;
  readonly 'templateMode.slide': string;
  readonly 'templateMode.empty': string;
  readonly 'templateMode.problems': string;
  readonly 'templateMode.clean': string;
  readonly 'templateMode.file.render': string;
  readonly 'templateMode.unsaved': string;
  readonly 'templateMode.saved': string;
  readonly 'templateMode.savedUnregistered': string;
  readonly 'templateMode.saveRefused': string;
  readonly 'templateMode.code': string;
  readonly 'templateMode.refused': string;
  readonly 'templateMode.new.name': string;
  readonly 'templateMode.new.create': string;
  readonly 'templateMode.new.problem.name': string;
  readonly 'templateMode.new.problem.exists': string;
  readonly 'templateMode.new.problem.write': string;
  readonly 'templateMode.discard.message': string;
  readonly 'templateMode.discard.detail': string;
  readonly 'templateMode.discard.confirm': string;
  readonly 'templateMode.discard.cancel': string;

  /** The plugins screen (TYTO-47). Opened by a command, so none of these is on screen at load. */
  readonly 'command.plugins.show': string;
  readonly 'plugins.heading': string;
  readonly 'plugins.notice': string;
  readonly 'plugins.inactive': string;
  readonly 'plugins.folder': string;
  readonly 'plugins.install': string;
  readonly 'plugins.column.name': string;
  readonly 'plugins.column.version': string;
  readonly 'plugins.column.origin': string;
  readonly 'plugins.column.status': string;
  readonly 'plugins.column.contributes': string;
  readonly 'plugins.column.permissions': string;
  readonly 'plugins.origin.builtIn': string;
  readonly 'plugins.origin.external': string;
  readonly 'plugins.status.enabled': string;
  readonly 'plugins.status.disabled': string;
  readonly 'plugins.status.refused': string;
  readonly 'plugins.status.crashed': string;
  readonly 'plugins.permissions.none': string;
  /** On the row of a plugin that contributes a panel: the document text reaches its page. */
  readonly 'plugins.panel.readsDocument': string;
  /**
   * On the row of a plugin that declares `font:<family>`: that face's file, installed on this
   * machine, is sent to the plugin's process (ADR 0048). The families follow it.
   */
  readonly 'plugins.font.sendsMachineFaces': string;
  readonly 'plugins.close': string;
  readonly 'plugins.unavailable': string;
  /**
   * Beside each `credentials:<key>` a plugin declares (TYTO-187): its state and a way to set or
   * clear it. Whether it is set, never what it is set to — `kept` says so on the screen.
   */
  readonly 'plugins.credential.label': string;
  readonly 'plugins.credential.set': string;
  readonly 'plugins.credential.notSet': string;
  readonly 'plugins.credential.placeholder': string;
  readonly 'plugins.credential.save': string;
  readonly 'plugins.credential.clear': string;
  readonly 'plugins.credential.kept': string;
  readonly 'plugins.credential.failed': string;

  /**
   * The local queue panel (TYTO-45). Closed in the default layout, so none of these is on
   * screen at load; `queue.status.*` are the words a row's status is shown in.
   */
  /** TYTO-206. Opens `settings.json` in a tab; a command, so it is not on screen at load. */
  readonly 'command.settings.open': string;
  /** TYTO-207. Opens `keybindings.json` in a tab; a command, so it is not on screen at load. */
  readonly 'command.keybindings.open': string;
  readonly 'command.queue.show': string;
  readonly 'queue.heading': string;
  readonly 'queue.folder.none': string;
  readonly 'queue.folder.choose': string;
  readonly 'queue.folder.clear': string;
  readonly 'queue.inbox': string;
  readonly 'queue.autoRun': string;
  /** The label before the file types a folder produces (TYTO-188). */
  readonly 'queue.kinds': string;
  readonly 'queue.empty': string;
  readonly 'queue.status.pending': string;
  readonly 'queue.status.rendering': string;
  readonly 'queue.status.done': string;
  readonly 'queue.status.error': string;
  readonly 'queue.run': string;
  readonly 'queue.retry': string;
  readonly 'queue.openBrief': string;
  readonly 'queue.openOutput': string;
  readonly 'queue.unavailable': string;
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
  'templates.folder.label',
  'templates.folder.none',
  'templates.folder.empty',
  'command.templates.chooseFolder',
  'command.templates.clearFolder',
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
  'file.saveFailed',
  'document.close',
  'document.discard.message',
  'document.discard.detail',
  'document.discard.confirm',
  'document.discard.cancel',
  'exit.save.message',
  'exit.save.detail.one',
  'exit.save.detail.many',
  'exit.save.confirm',
  'exit.save.discard',
  'exit.save.cancel',
  'menu.revealLogs',
  'crash.title',
  'crash.detail',
  'crash.noLog',
  'crash.close',
  'import.message',
  'import.detail',
  'import.credentials',
  'import.confirm',
  'import.decline',
  'update.available',
  'update.downloading',
  'update.ready',
  'menu.file',
  'command.document.new',
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
  'panel.queue',
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
  'command.layout.toggleDock.left',
  'command.layout.toggleDock.right',
  'command.layout.toggleDock.bottom',
  'status.commandBar',
  'status.position',
  'status.selected',
  'status.kind.settings',
  'status.kind.keybindings',
  'status.problems.new',
  'menu.about',
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
  'export.leftovers',
  'command.file.export',
  'command.template.edit',
  'command.template.new',
  'templateMode.heading',
  'templateMode.save',
  'templateMode.close',
  'templateMode.openOther',
  'templateMode.example',
  'templateMode.noExample',
  'templateMode.slide',
  'templateMode.empty',
  'templateMode.problems',
  'templateMode.clean',
  'templateMode.file.render',
  'templateMode.unsaved',
  'templateMode.saved',
  'templateMode.savedUnregistered',
  'templateMode.saveRefused',
  'templateMode.code',
  'templateMode.refused',
  'templateMode.new.name',
  'templateMode.new.create',
  'templateMode.new.problem.name',
  'templateMode.new.problem.exists',
  'templateMode.new.problem.write',
  'templateMode.discard.message',
  'templateMode.discard.detail',
  'templateMode.discard.confirm',
  'templateMode.discard.cancel',
  'command.plugins.show',
  'plugins.heading',
  'plugins.notice',
  'plugins.inactive',
  'plugins.folder',
  'plugins.install',
  'plugins.column.name',
  'plugins.column.version',
  'plugins.column.origin',
  'plugins.column.status',
  'plugins.column.contributes',
  'plugins.column.permissions',
  'plugins.origin.builtIn',
  'plugins.origin.external',
  'plugins.status.enabled',
  'plugins.status.disabled',
  'plugins.status.refused',
  'plugins.status.crashed',
  'plugins.permissions.none',
  'plugins.panel.readsDocument',
  'plugins.font.sendsMachineFaces',
  'plugins.close',
  'plugins.unavailable',
  'plugins.credential.label',
  'plugins.credential.set',
  'plugins.credential.notSet',
  'plugins.credential.placeholder',
  'plugins.credential.save',
  'plugins.credential.clear',
  'plugins.credential.kept',
  'plugins.credential.failed',
  'command.settings.open',
  'command.keybindings.open',
  'command.queue.show',
  'queue.heading',
  'queue.folder.none',
  'queue.folder.choose',
  'queue.folder.clear',
  'queue.inbox',
  'queue.autoRun',
  'queue.kinds',
  'queue.empty',
  'queue.status.pending',
  'queue.status.rendering',
  'queue.status.done',
  'queue.status.error',
  'queue.run',
  'queue.retry',
  'queue.openBrief',
  'queue.openOutput',
  'queue.unavailable',
] as const satisfies readonly CatalogueKey[];
