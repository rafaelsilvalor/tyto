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
  readonly 'preview.heading': string;
  /** TYTO-323: the strip toggle's words while the strip shows and while it is hidden, and the
   * strip's accessible name. */
  readonly 'preview.strip.hide': string;
  readonly 'preview.strip.show': string;
  readonly 'preview.strip.label': string;
  readonly 'preview.mode.one': string;
  readonly 'preview.mode.all': string;
  readonly 'preview.zoom.out': string;
  readonly 'preview.zoom.in': string;
  readonly 'preview.zoom.fit': string;
  /**
   * TYTO-366, ADR 0124: an image from the explorer in the preview. The bar's line says
   * `scalable` after an SVG's size when the size is its viewBox; the stage says why an image is
   * not shown, with `{size}` and `{limit}` written by the window.
   */
  readonly 'preview.image.scalable': string;
  readonly 'preview.image.tooLarge': string;
  readonly 'preview.image.unsupported': string;
  readonly 'preview.image.gone': string;
  /** Shown in place of a frame while the brief produces none. */
  readonly 'preview.empty': string;
  /**
   * Shown in place of a frame when a brief is written and cannot be drawn (TYTO-268): its
   * compile failed fatally and there is no older artwork to keep on screen. Points at the
   * problems panel rather than repeating the error, which is that panel's job.
   */
  readonly 'preview.broken': string;
  /**
   * The artwork on screen is older than the brief being typed (E9.13).
   *
   * A state of the preview and not a second error message: the problems panel already lists
   * what is wrong, and this says only that the picture and the text have stopped agreeing.
   * It has to read well with that panel closed, which is the case the card is about.
   */
  readonly 'preview.stale': string;
  /**
   * TYTO-287. The preview tab's lock: the button in its bar, and the title of the lock drawn
   * on a locked preview's tab. `preview.heading` is the word a preview tab's name starts with.
   */
  readonly 'preview.lock': string;
  readonly 'preview.locked': string;
  /** The bottom panel that lists what the stages had to say about the brief. */
  readonly 'problems.heading': string;
  readonly 'problems.empty': string;
  /**
   * The empty state with one of the app's own files in front (TYTO-322): the panel names the
   * file, because "this brief" is wrong there. `problems.empty` stays the brief's.
   */
  readonly 'problems.empty.settings': string;
  readonly 'problems.empty.keybindings': string;
  readonly 'problems.empty.snippets': string;
  /** TYTO-247, ADR 0132: a `.txt` or `.md` tab, which nothing checks. */
  readonly 'problems.empty.text': string;
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
  readonly 'command.workspace.openFolder': string;
  readonly 'command.workspace.closeFolder': string;
  readonly 'command.workspace.manageTrust': string;
  /**
   * TYTO-487. The recent folders: the command, the title bar's button when no folder is open,
   * and the popover it opens.
   */
  readonly 'command.workspace.openRecent': string;
  readonly 'titleBar.noFolder': string;
  readonly 'recentFolders.label': string;
  readonly 'recentFolders.search': string;
  readonly 'recentFolders.heading': string;
  readonly 'recentFolders.empty': string;
  readonly 'recentFolders.noMatch': string;
  readonly 'recentFolders.current': string;
  readonly 'recentFolders.openLocal': string;
  readonly 'command.pluginFiles.sync': string;
  readonly 'command.pluginFiles.update': string;
  readonly 'pluginFiles.approve.message': string;
  readonly 'pluginFiles.approve.load': string;
  readonly 'pluginFiles.approve.skip': string;
  readonly 'cli.confirm.yes': string;
  readonly 'cli.confirm.no': string;
  readonly 'terminal.quit.message': string;
  readonly 'terminal.quit.quit': string;
  readonly 'terminal.quit.stay': string;
  readonly 'panel.terminal': string;
  readonly 'command.terminal.new': string;
  readonly 'terminal.new': string;
  readonly 'terminal.sessions': string;
  readonly 'terminal.session.close': string;
  readonly 'terminal.restricted': string;
  readonly 'terminal.trust': string;
  readonly 'terminal.exited': string;
  readonly 'terminal.paste.message': string;
  readonly 'terminal.paste.detail': string;
  readonly 'terminal.paste.confirm': string;
  readonly 'terminal.paste.cancel': string;
  readonly 'command.workspace.showProject': string;
  readonly 'workspace.banner.text': string;
  readonly 'workspace.banner.trust': string;
  readonly 'workspace.banner.problems': string;
  readonly 'workspace.banner.project': string;
  readonly 'workspace.trust.heading': string;
  readonly 'workspace.trust.none': string;
  readonly 'workspace.trust.trusted': string;
  readonly 'workspace.trust.restricted': string;
  readonly 'workspace.trust.revoked': string;
  readonly 'workspace.trust.grant': string;
  readonly 'workspace.trust.revoke': string;
  readonly 'workspace.trust.close': string;
  readonly 'workspace.banner.profile': string;
  readonly 'workspace.banner.trustProfile': string;
  readonly 'workspace.trust.profile': string;
  readonly 'workspace.trust.profileByLocation': string;
  readonly 'workspace.trust.profileTrusted': string;
  readonly 'workspace.trust.profileRestricted': string;
  readonly 'workspace.trust.profileRevoked': string;
  readonly 'workspace.trust.revokeProfile': string;
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
   * TYTO-113, ADR 0080. A kept draft that was not put back over its file, because the file
   * changed while the app was closed; the draft is in a new tab beside it. The file's name is
   * appended, as `file.missing` appends it.
   */
  readonly 'session.draftStale': string;
  /**
   * TYTO-513, ADR 0165. The status bar's notice when another folder was asked for but the tabs
   * could not be kept while one held unsaved text: the folder stays as it was.
   */
  readonly 'session.folderNotSwitched': string;

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
  /**
   * The detail in place of `document.discard.detail` for the settings tab (TYTO-255): closing
   * it unsaved loses the typing, while a screen's change it held still reaches the file.
   */
  readonly 'document.discard.settingsDetail': string;
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
   *
   * Since TYTO-264 it carries its mnemonic, `&` before the letter Alt opens it with, as the four
   * keys after it do (ADR 0078). Each language picks its own letters, unique within it.
   */
  readonly 'menu.file': string;
  /**
   * The other four top-level titles (TYTO-264). Their roles' own labels are Electron's fixed
   * English on Windows and Linux — not the system's language — and carry no mnemonic, so off
   * macOS the template writes these over them. macOS keeps the roles' titles (ADR 0078 §2).
   */
  readonly 'menu.edit': string;
  readonly 'menu.view': string;
  readonly 'menu.window': string;
  readonly 'menu.help': string;
  /**
   * The items inside the Edit, View and Window lists, and inside macOS's application menu, that
   * are Electron roles (TYTO-334). A role's own label is Electron's fixed English on Windows and
   * Linux, so the template writes these over it and keeps the role for what the item does.
   * `exit` is the Windows word and `quit` the macOS and Linux one, as Electron has them.
   */
  readonly 'menu.role.undo': string;
  readonly 'menu.role.redo': string;
  readonly 'menu.role.cut': string;
  readonly 'menu.role.copy': string;
  readonly 'menu.role.paste': string;
  readonly 'menu.role.pasteAndMatchStyle': string;
  readonly 'menu.role.delete': string;
  readonly 'menu.role.selectAll': string;
  readonly 'menu.role.exit': string;
  readonly 'menu.role.quit': string;
  readonly 'menu.role.toggleDevTools': string;
  readonly 'menu.role.togglefullscreen': string;
  readonly 'menu.role.minimize': string;
  readonly 'menu.role.zoom': string;
  readonly 'menu.role.front': string;
  readonly 'menu.role.services': string;
  readonly 'menu.role.hide': string;
  readonly 'menu.role.hideOthers': string;
  readonly 'menu.role.unhide': string;
  readonly 'command.document.new': string;
  readonly 'command.document.close': string;
  readonly 'command.document.next': string;
  readonly 'command.document.previous': string;
  readonly 'command.group.splitRight': string;
  readonly 'command.group.splitDown': string;
  readonly 'command.group.focusNext': string;
  readonly 'command.group.focusPrevious': string;
  readonly 'command.group.moveTabToNext': string;
  /** TYTO-288. The tab in front one place along its strip. */
  readonly 'command.group.moveTabLeft': string;
  readonly 'command.group.moveTabRight': string;
  readonly 'command.group.close': string;
  /** TYTO-287. The preview as a tab: beside the brief, in its group, and its lock. */
  readonly 'command.preview.openToSide': string;
  readonly 'command.preview.open': string;
  readonly 'command.preview.toggleLock': string;
  readonly 'command.preview.showOneSlide': string;
  readonly 'command.preview.showAllSlides': string;
  /** A prefix: the tab's own name follows it, the way a recent entry's does. */
  readonly 'command.document.select': string;

  /**
   * The dock, its panels and the commands that show and hide them (E9.10).
   *
   * `panel.*` are the panel names a command bar entry reads — "Mostrar ou esconder:
   * Problemas" — and they are separate from `problems.heading` and friends on purpose: a
   * heading sits over a pane and names what is in it, and this names the panel itself in a
   * list of panels. They happen to read the same today and will not once a panel's heading
   * carries a file name.
   */
  readonly 'panel.close': string;
  /** ADR 0163: the × of the tabbed bottom area, and the name its strip of tabs is read by. */
  readonly 'panel.hideArea': string;
  readonly 'panel.tabs': string;
  readonly 'command.layout.togglePanel': string;
  readonly 'command.layout.restore': string;
  readonly 'panel.editor': string;
  readonly 'panel.problems': string;
  /** TYTO-45. Closed in the default layout, like the panel it names. */
  readonly 'panel.queue': string;
  readonly 'panel.project': string;
  /** TYTO-279. The explorer, closed in the default layout until a folder is opened. */
  readonly 'panel.explorer': string;

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
  readonly 'status.kind.snippets': string;
  /** TYTO-247: a `.txt` tab and a `.md` tab. "Markdown" is the format's name in both. */
  readonly 'status.kind.text': string;
  readonly 'status.kind.markdown': string;
  /**
   * TYTO-247, ADR 0132: the file dialogs' filters after "Brief" — the text files, and every file
   * a tab opens. Main builds them in the window's language at each dialog.
   */
  readonly 'dialog.files.text': string;
  readonly 'dialog.files.supported': string;
  /** TYTO-377: a `.recipe` file, in the dialogs, the status bar and the empty Problems panel. */
  readonly 'dialog.files.recipe': string;
  readonly 'status.kind.recipe': string;
  readonly 'problems.empty.recipe': string;
  /** TYTO-377: the one command that runs a whole recipe, the person's approval (ADR 0148). */
  readonly 'command.recipe.run': string;
  /**
   * TYTO-377: the muted line under a recipe's cell. `.one` is the singular; the window joins a
   * table's two counts with a middle dot.
   */
  readonly 'recipe.cell.rows': string;
  readonly 'recipe.cell.rows.one': string;
  readonly 'recipe.cell.columns': string;
  readonly 'recipe.cell.columns.one': string;
  readonly 'recipe.cell.plan': string;
  readonly 'recipe.cell.failed': string;
  readonly 'recipe.cell.skipped': string;
  readonly 'recipe.cell.stale': string;
  readonly 'recipe.cell.held.source': string;
  readonly 'recipe.cell.held.restricted': string;
  /**
   * TYTO-377, the notebook's table: the two commands that run from the cursor's cell and fetch
   * again, the age line (`{when}` is `Intl.RelativeTimeFormat`'s, in the window's language),
   * what the table leaves out, the buttons and the fold toggle's name.
   */
  readonly 'command.recipe.runFromCell': string;
  readonly 'command.recipe.runFresh': string;
  readonly 'recipe.cell.ran': string;
  readonly 'recipe.cell.fetched': string;
  readonly 'recipe.cell.more': string;
  readonly 'recipe.cell.more.one': string;
  readonly 'recipe.cell.runFrom': string;
  readonly 'recipe.cell.fetchAgain': string;
  readonly 'recipe.cell.collapse': string;
  readonly 'recipe.cell.expand': string;
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
  /**
   * A prefix, like `command.file.recent`: an export preset's command reads "Export: entregas",
   * the preset's name as written in the project file (TYTO-270, ADR 0126).
   */
  readonly 'command.export.preset': string;

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
  /**
   * On the row of a plugin that declares `workspace:read` or `workspace:write` (ADR 0138): the
   * files of the folder open in the window, whichever it is when the plugin asks.
   */
  readonly 'plugins.workspace.reads': string;
  readonly 'plugins.workspace.writes': string;
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
  /**
   * TYTO-304. The labels of the settings tab's hover help, before a setting's type, its default
   * and the values it accepts. The descriptions themselves are the plugins', in English.
   */
  readonly 'settings.assist.type': string;
  readonly 'settings.assist.default': string;
  readonly 'settings.assist.accepted': string;
  readonly 'keybindings.assist.defaultKey': string;
  /**
   * TYTO-334. What the keybindings tab says about an entry's three fields, and beside a
   * removal; `{title}` is the command's title and `{key}` its default key.
   */
  readonly 'keybindings.assist.field.key': string;
  readonly 'keybindings.assist.field.command': string;
  readonly 'keybindings.assist.field.when': string;
  readonly 'keybindings.assist.removes': string;
  readonly 'keybindings.assist.removesWithKey': string;
  /** TYTO-207. Opens `keybindings.json` in a tab; a command, so it is not on screen at load. */
  readonly 'command.keybindings.open': string;
  /** TYTO-277. Opens `snippets.json` in a tab; a command, so it is not on screen at load. */
  readonly 'command.snippets.open': string;
  /** TYTO-113. View > Reload, and the bar's row for `Mod-r`; not on screen at load. */
  readonly 'command.window.reload': string;
  /** TYTO-272. View > Zoom, and the bar's rows for `Mod-0`, `Mod-=` and `Mod--`. */
  readonly 'command.window.zoomReset': string;
  readonly 'command.window.zoomIn': string;
  readonly 'command.window.zoomOut': string;
  /** TYTO-318. Help > Documentation, and the bar's row; opens the manual in the browser. */
  readonly 'command.help.openDocumentation': string;
  /**
   * TYTO-272. The problems row for a `uiFontFamily` or `codeFontFamily` this machine does not
   * have; the setting and the name follow it. Set from code, so not on screen at load.
   */
  readonly 'typography.familyMissing': string;
  /**
   * TYTO-208. "Preferences: Color Theme", the picker's placeholder and the two kinds shown
   * beside each theme. All four are the bar's, so none is on screen at load.
   */
  readonly 'command.theme.pick': string;
  readonly 'theme.pick.placeholder': string;
  readonly 'theme.kind.light': string;
  readonly 'theme.kind.dark': string;
  readonly 'theme.variant.original': string;
  readonly 'theme.variant.adjusted': string;
  readonly 'command.document.newFromTemplate': string;
  readonly 'template.pick.placeholder': string;
  readonly 'template.root.builtIn': string;
  /**
   * TYTO-467. Where an alias came from, on hover in "New brief from template…" and in the
   * panel beside the "/" menu's row: `{template}`, `{configuration}` and `{file}` are the
   * row's. Neither surface is on screen at load.
   */
  readonly 'template.alias.declared': string;
  /**
   * TYTO-276. The "/" menu: the command that opens it without a "/", its section heading and
   * the line beside each template saying what choosing it does. `{current}` is the template
   * the brief names now. All of it is CodeMirror's list or the bar, so none is on screen at load.
   */
  readonly 'command.editor.insertMenu': string;
  /**
   * TYTO-296. "Go to Block…", its placeholder and the frontmatter's row, whose name is the
   * window's because `@tyto/editor` owns no words. All three are the bar's, so none is on
   * screen at load.
   */
  readonly 'command.editor.goToBlock': string;
  readonly 'goToBlock.placeholder': string;
  readonly 'goToBlock.header': string;
  /**
   * TYTO-273. The frontmatter's name in an editor group's breadcrumb, before the key the caret
   * is on: `cabeçalho › template`. Written by `main.ts` into the header row, not by the
   * `data-i18n` pass, and only while the caret is in a frontmatter.
   */
  readonly 'breadcrumb.frontmatter': string;
  /**
   * TYTO-297. "Format Brief" in the bar, and the line the status bar shows for a few seconds
   * when a brief with a syntax error refuses it. Both set by script, so neither is on screen
   * at load.
   */
  readonly 'command.editor.formatBrief': string;
  readonly 'formatBrief.refused': string;
  /** TYTO-489, ADR 0157: Delivery: New… — the command, its two questions and its refusals. */
  readonly 'command.delivery.new': string;
  readonly 'delivery.name.placeholder': string;
  readonly 'delivery.template.placeholder': string;
  readonly 'delivery.template.none': string;
  /** `{problem}` is the diagnostic's own sentence, which says why. */
  readonly 'delivery.refused': string;
  readonly 'delivery.noFolder': string;
  /**
   * TYTO-490, ADR 0157 §6: the delivery's export — the command and the strip's button, the
   * button's tooltip while the brief in front is in no delivery, and the refusal.
   */
  readonly 'command.delivery.export': string;
  readonly 'delivery.export.notInDelivery': string;
  /** `{problem}` is the diagnostic's own sentence, which says why. */
  readonly 'delivery.export.refused': string;
  readonly 'slash.section.templates': string;
  /** TYTO-277. The heading over the person's snippets in the same menu. */
  readonly 'slash.section.snippets': string;
  readonly 'slash.template.new': string;
  readonly 'slash.template.set': string;
  readonly 'slash.template.current': string;
  readonly 'slash.template.switch': string;
  readonly 'command.queue.show': string;
  readonly 'queue.heading': string;
  readonly 'project.heading': string;
  /** TYTO-279. The explorer's header, its line with no folder open, an empty folder, a capped one. */
  readonly 'explorer.heading': string;
  readonly 'explorer.none': string;
  readonly 'explorer.empty': string;
  readonly 'explorer.more': string;
  /**
   * TYTO-352, ADR 0121. The explorer's context menu, the delete question and the line under the
   * name field. `{bin}` is the system's trash, by the platform's name in English and *Lixeira*
   * in Portuguese on all three; `{name}`, `{count}` and `{reason}` are filled by the panel.
   */
  readonly 'explorer.menu.newFile': string;
  readonly 'explorer.menu.newFolder': string;
  readonly 'explorer.menu.rename': string;
  readonly 'explorer.menu.delete': string;
  /**
   * TYTO-365. The explorer's header button that folds every folder; New File and New Folder
   * reuse the menu's two keys above.
   */
  readonly 'explorer.collapseAll': string;
  readonly 'explorer.bin.windows': string;
  readonly 'explorer.bin.other': string;
  readonly 'explorer.delete.file': string;
  readonly 'explorer.delete.folder': string;
  readonly 'explorer.delete.detail': string;
  readonly 'explorer.delete.unsaved.one': string;
  readonly 'explorer.delete.unsaved.many': string;
  readonly 'explorer.delete.confirm': string;
  readonly 'explorer.delete.cancel': string;
  readonly 'explorer.error.exists': string;
  readonly 'explorer.error.invalid': string;
  readonly 'explorer.error.trash': string;
  readonly 'explorer.error.failed': string;
  readonly 'project.none': string;
  readonly 'project.unset': string;
  readonly 'project.origin.folder': string;
  readonly 'project.origin.profile': string;
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

  /**
   * TYTO-496 (ADR 0159). The command panel: its name in a list of panels and over the panel
   * (one string, so renaming it is one edit per language), and its own words.
   */
  readonly 'panel.commands': string;
  /** TYTO-496. The command panel's entries in the command bar. */
  readonly 'command.commandPanel.run': string;
  readonly 'command.commandPanel.renderBrief': string;
  /** TYTO-496. The completion list under the command panel's prompt. */
  readonly 'commandPanel.suggestions': string;
  readonly 'commandPanel.sessions': string;
  readonly 'commandPanel.session': string;
  readonly 'commandPanel.session.new': string;
  readonly 'commandPanel.session.close': string;
  readonly 'commandPanel.stop': string;
  readonly 'commandPanel.find': string;
  readonly 'commandPanel.find.next': string;
  readonly 'commandPanel.find.close': string;
  readonly 'commandPanel.find.count': string;
  readonly 'commandPanel.find.none': string;
  readonly 'commandPanel.clear': string;
  readonly 'commandPanel.output': string;
  readonly 'commandPanel.input': string;
  readonly 'commandPanel.dropped': string;
  readonly 'commandPanel.busy': string;
  readonly 'commandPanel.unclosedQuote': string;
  readonly 'commandPanel.refused': string;
  readonly 'commandPanel.link': string;
  readonly 'commandPanel.history.search': string;
  readonly 'commandPanel.history.none': string;
  readonly 'commandPanel.state.idle': string;
  readonly 'commandPanel.state.running': string;
  readonly 'commandPanel.state.waiting': string;
  readonly 'commandPanel.state.cancelled': string;
  readonly 'commandPanel.state.finished': string;
  /** TYTO-496: a line refused before it ran, on its run's header. */
  readonly 'commandPanel.state.refused': string;
  /** TYTO-496: how a command's run ended, in its Problems section's header. */
  readonly 'problems.command.exit': string;
  /** TYTO-504, ADR 0162: the gallery screen, its filters, a card's states and what a click did. */
  readonly 'command.gallery.show': string;
  readonly 'gallery.heading': string;
  readonly 'gallery.index': string;
  readonly 'gallery.loading': string;
  readonly 'gallery.unavailable': string;
  readonly 'gallery.cached': string;
  readonly 'gallery.empty': string;
  readonly 'gallery.filters': string;
  readonly 'gallery.filter.all': string;
  readonly 'gallery.filter.templates': string;
  readonly 'gallery.filter.plugins': string;
  readonly 'gallery.filter.installed': string;
  readonly 'gallery.filter.updates': string;
  readonly 'gallery.kind.template': string;
  readonly 'gallery.kind.plugin': string;
  readonly 'gallery.install': string;
  readonly 'gallery.installing': string;
  readonly 'gallery.installed': string;
  readonly 'gallery.update': string;
  readonly 'gallery.updating': string;
  readonly 'gallery.pinned': string;
  readonly 'gallery.changes': string;
  readonly 'gallery.incompatible': string;
  readonly 'gallery.notSynced': string;
  readonly 'gallery.configurations': string;
  readonly 'gallery.done.written': string;
  readonly 'gallery.done.already': string;
  readonly 'gallery.done.moved': string;
  readonly 'gallery.done.current': string;
  readonly 'gallery.byHand': string;
  readonly 'gallery.force': string;
  readonly 'gallery.close': string;
}

export type CatalogueKey = keyof Catalogue;

export const CATALOGUE_KEYS = [
  'app.name',
  'preview.heading',
  'preview.strip.hide',
  'preview.strip.show',
  'preview.strip.label',
  'preview.mode.one',
  'preview.mode.all',
  'preview.zoom.out',
  'preview.zoom.in',
  'preview.zoom.fit',
  'preview.image.scalable',
  'preview.image.tooLarge',
  'preview.image.unsupported',
  'preview.image.gone',
  'preview.empty',
  'preview.broken',
  'preview.stale',
  'preview.lock',
  'preview.locked',
  'problems.heading',
  'problems.empty',
  'problems.empty.settings',
  'problems.empty.keybindings',
  'problems.empty.snippets',
  'problems.empty.text',
  'problems.severity.error',
  'problems.severity.warning',
  'problems.severity.info',
  'problems.location',
  'problems.nowhere',
  'template.label',
  'templates.folder.label',
  'templates.folder.none',
  'templates.folder.empty',
  'command.templates.chooseFolder',
  'command.templates.clearFolder',
  'command.workspace.openFolder',
  'command.workspace.closeFolder',
  'command.workspace.manageTrust',
  'command.workspace.openRecent',
  'titleBar.noFolder',
  'recentFolders.label',
  'recentFolders.search',
  'recentFolders.heading',
  'recentFolders.empty',
  'recentFolders.noMatch',
  'recentFolders.current',
  'recentFolders.openLocal',
  'command.pluginFiles.sync',
  'command.pluginFiles.update',
  'pluginFiles.approve.message',
  'pluginFiles.approve.load',
  'pluginFiles.approve.skip',
  'cli.confirm.yes',
  'cli.confirm.no',
  'terminal.quit.message',
  'terminal.quit.quit',
  'terminal.quit.stay',
  'panel.terminal',
  'command.terminal.new',
  'terminal.new',
  'terminal.sessions',
  'terminal.session.close',
  'terminal.restricted',
  'terminal.trust',
  'terminal.exited',
  'terminal.paste.message',
  'terminal.paste.detail',
  'terminal.paste.confirm',
  'terminal.paste.cancel',
  'command.workspace.showProject',
  'workspace.banner.text',
  'workspace.banner.trust',
  'workspace.banner.problems',
  'workspace.banner.project',
  'workspace.trust.heading',
  'workspace.trust.none',
  'workspace.trust.trusted',
  'workspace.trust.restricted',
  'workspace.trust.revoked',
  'workspace.trust.grant',
  'workspace.trust.revoke',
  'workspace.trust.close',
  'workspace.banner.profile',
  'workspace.banner.trustProfile',
  'workspace.trust.profile',
  'workspace.trust.profileByLocation',
  'workspace.trust.profileTrusted',
  'workspace.trust.profileRestricted',
  'workspace.trust.profileRevoked',
  'workspace.trust.revokeProfile',
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
  'session.draftStale',
  'session.folderNotSwitched',
  'document.close',
  'document.discard.message',
  'document.discard.detail',
  'document.discard.settingsDetail',
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
  'menu.edit',
  'menu.view',
  'menu.window',
  'menu.help',
  'menu.role.undo',
  'menu.role.redo',
  'menu.role.cut',
  'menu.role.copy',
  'menu.role.paste',
  'menu.role.pasteAndMatchStyle',
  'menu.role.delete',
  'menu.role.selectAll',
  'menu.role.exit',
  'menu.role.quit',
  'menu.role.toggleDevTools',
  'menu.role.togglefullscreen',
  'menu.role.minimize',
  'menu.role.zoom',
  'menu.role.front',
  'menu.role.services',
  'menu.role.hide',
  'menu.role.hideOthers',
  'menu.role.unhide',
  'command.document.new',
  'command.document.close',
  'command.document.next',
  'command.document.previous',
  'command.group.splitRight',
  'command.group.splitDown',
  'command.group.focusNext',
  'command.group.focusPrevious',
  'command.group.moveTabToNext',
  'command.group.moveTabLeft',
  'command.group.moveTabRight',
  'command.group.close',
  'command.preview.openToSide',
  'command.preview.open',
  'command.preview.toggleLock',
  'command.preview.showOneSlide',
  'command.preview.showAllSlides',
  'command.document.select',
  'panel.close',
  'panel.hideArea',
  'panel.tabs',
  'command.layout.togglePanel',
  'command.layout.restore',
  'panel.editor',
  'panel.problems',
  'panel.queue',
  'panel.project',
  'panel.explorer',
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
  'status.kind.snippets',
  'status.kind.text',
  'status.kind.markdown',
  'dialog.files.text',
  'dialog.files.supported',
  'dialog.files.recipe',
  'status.kind.recipe',
  'problems.empty.recipe',
  'command.recipe.run',
  'recipe.cell.rows',
  'recipe.cell.rows.one',
  'recipe.cell.columns',
  'recipe.cell.columns.one',
  'recipe.cell.plan',
  'recipe.cell.failed',
  'recipe.cell.skipped',
  'recipe.cell.stale',
  'recipe.cell.held.source',
  'recipe.cell.held.restricted',
  'command.recipe.runFromCell',
  'command.recipe.runFresh',
  'recipe.cell.ran',
  'recipe.cell.fetched',
  'recipe.cell.more',
  'recipe.cell.more.one',
  'recipe.cell.runFrom',
  'recipe.cell.fetchAgain',
  'recipe.cell.collapse',
  'recipe.cell.expand',
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
  'command.export.preset',
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
  'plugins.workspace.reads',
  'plugins.workspace.writes',
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
  'settings.assist.type',
  'settings.assist.default',
  'settings.assist.accepted',
  'keybindings.assist.defaultKey',
  'keybindings.assist.field.key',
  'keybindings.assist.field.command',
  'keybindings.assist.field.when',
  'keybindings.assist.removes',
  'keybindings.assist.removesWithKey',
  'command.keybindings.open',
  'command.snippets.open',
  'command.window.reload',
  'command.window.zoomReset',
  'command.window.zoomIn',
  'command.window.zoomOut',
  'command.help.openDocumentation',
  'typography.familyMissing',
  'command.theme.pick',
  'theme.pick.placeholder',
  'theme.kind.light',
  'theme.kind.dark',
  'theme.variant.original',
  'theme.variant.adjusted',
  'command.document.newFromTemplate',
  'template.pick.placeholder',
  'template.root.builtIn',
  'template.alias.declared',
  'command.editor.insertMenu',
  'command.editor.goToBlock',
  'goToBlock.placeholder',
  'goToBlock.header',
  'breadcrumb.frontmatter',
  'command.editor.formatBrief',
  'formatBrief.refused',
  'command.delivery.new',
  'delivery.name.placeholder',
  'delivery.template.placeholder',
  'delivery.template.none',
  'delivery.refused',
  'delivery.noFolder',
  'command.delivery.export',
  'delivery.export.notInDelivery',
  'delivery.export.refused',
  'slash.section.templates',
  'slash.section.snippets',
  'slash.template.new',
  'slash.template.set',
  'slash.template.current',
  'slash.template.switch',
  'command.queue.show',
  'queue.heading',
  'project.heading',
  'explorer.heading',
  'explorer.none',
  'explorer.empty',
  'explorer.more',
  'explorer.menu.newFile',
  'explorer.menu.newFolder',
  'explorer.menu.rename',
  'explorer.menu.delete',
  'explorer.collapseAll',
  'explorer.bin.windows',
  'explorer.bin.other',
  'explorer.delete.file',
  'explorer.delete.folder',
  'explorer.delete.detail',
  'explorer.delete.unsaved.one',
  'explorer.delete.unsaved.many',
  'explorer.delete.confirm',
  'explorer.delete.cancel',
  'explorer.error.exists',
  'explorer.error.invalid',
  'explorer.error.trash',
  'explorer.error.failed',
  'project.none',
  'project.unset',
  'project.origin.folder',
  'project.origin.profile',
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
  'panel.commands',
  'command.commandPanel.run',
  'command.commandPanel.renderBrief',
  'commandPanel.suggestions',
  'commandPanel.sessions',
  'commandPanel.session',
  'commandPanel.session.new',
  'commandPanel.session.close',
  'commandPanel.stop',
  'commandPanel.find',
  'commandPanel.find.next',
  'commandPanel.find.close',
  'commandPanel.find.count',
  'commandPanel.find.none',
  'commandPanel.clear',
  'commandPanel.output',
  'commandPanel.input',
  'commandPanel.dropped',
  'commandPanel.busy',
  'commandPanel.unclosedQuote',
  'commandPanel.refused',
  'commandPanel.link',
  'commandPanel.history.search',
  'commandPanel.history.none',
  'commandPanel.state.idle',
  'commandPanel.state.running',
  'commandPanel.state.waiting',
  'commandPanel.state.cancelled',
  'commandPanel.state.finished',
  'commandPanel.state.refused',
  'problems.command.exit',
  'command.gallery.show',
  'gallery.heading',
  'gallery.index',
  'gallery.loading',
  'gallery.unavailable',
  'gallery.cached',
  'gallery.empty',
  'gallery.filters',
  'gallery.filter.all',
  'gallery.filter.templates',
  'gallery.filter.plugins',
  'gallery.filter.installed',
  'gallery.filter.updates',
  'gallery.kind.template',
  'gallery.kind.plugin',
  'gallery.install',
  'gallery.installing',
  'gallery.installed',
  'gallery.update',
  'gallery.updating',
  'gallery.pinned',
  'gallery.changes',
  'gallery.incompatible',
  'gallery.notSynced',
  'gallery.configurations',
  'gallery.done.written',
  'gallery.done.already',
  'gallery.done.moved',
  'gallery.done.current',
  'gallery.byHand',
  'gallery.force',
  'gallery.close',
] as const satisfies readonly CatalogueKey[];
