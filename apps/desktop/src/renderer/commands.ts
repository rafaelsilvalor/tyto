import {
  type CommandRegistry,
  type EditorKeymap,
  type Keybinding,
  type KeybindingEntry,
  type KeybindingLayer,
  type KeybindingTable,
  type KeyStroke,
  COMMAND_BAR_KEY,
  COMMAND_BAR_TOGGLE,
  EDITOR_FIND,
  EDITOR_FIND_NEXT,
  EDITOR_FIND_PREVIOUS,
  EDITOR_GOTO_LINE,
  EDITOR_REDO,
  EDITOR_REPLACE_ALL,
  EDITOR_REPLACE_NEXT,
  EDITOR_SAVE,
  EDITOR_SPLIT_DOWN,
  EDITOR_SPLIT_RIGHT,
  EDITOR_UNDO,
  bindingsOf,
  createCommandRegistry,
  defaultKeymapSet,
  keyOfStroke,
  keybindingsOf,
  keymapSetFor as keymapSetOfTable,
  vimKeymapSet,
} from '@tyto/editor';

import type { IpcResponse } from '../../shared/ipc.js';

import { type CatalogueKey } from '../../shared/i18n/index.js';
import { type HideableDock, COMMANDS_PANEL } from '../../shared/layout.js';

/**
 * What the window can be told to do, as ids (E9.12).
 *
 * `@tyto/editor` has shipped a command registry since E8.3, and its own comment says the
 * order of `list()` is the order a palette should show — and until this card nothing in
 * `apps/desktop/src` named `createCommandRegistry`. The registry was built and never wired.
 *
 * **The point of the ids is that a key and a palette entry name the same string.** A
 * binding, a vim ex-command and, later, a plugin all dispatch through `registry.run(id)`,
 * so `Mod-z` and "Desfazer" cannot drift into being two different undos.
 */

export const PREVIEW_ZOOM_IN = 'preview.zoomIn';
export const PREVIEW_ZOOM_OUT = 'preview.zoomOut';
export const PREVIEW_ZOOM_FIT = 'preview.zoomFit';
export const PREVIEW_NEXT_FORMAT = 'preview.nextFormat';
export const PREVIEW_PREVIOUS_FORMAT = 'preview.previousFormat';
export const PREVIEW_NEXT_SLIDE = 'preview.nextSlide';
export const PREVIEW_PREVIOUS_SLIDE = 'preview.previousSlide';
/**
 * The preview as a tab (TYTO-287, ADR 0084): beside the brief — `Mod-Shift-v`, VS Code's key,
 * global so it answers from a preview too — or in the focused group, and the lock that pins a
 * following preview to the brief it shows.
 */
export const PREVIEW_OPEN_TO_SIDE = 'preview.openToSide';
export const PREVIEW_OPEN = 'preview.open';
export const PREVIEW_TOGGLE_LOCK = 'preview.toggleLock';
/**
 * TYTO-323 (ADR 0123): the preview's two modes. No default key: the card asks for none unless one
 * is free, and the preview's other commands but Ctrl+Shift+V have none either.
 */
export const PREVIEW_SHOW_ONE_SLIDE = 'preview.showOneSlide';
export const PREVIEW_SHOW_ALL_SLIDES = 'preview.showAllSlides';
export const SHELL_TOGGLE_LOCALE = 'shell.toggleLocale';
export const LAYOUT_RESTORE = 'layout.restore';
/**
 * Showing and hiding one panel, as a command per panel (E9.10).
 *
 * Per panel and not one command taking an argument, because the bar runs an id and nothing
 * else — a person types "problemas" and the row they want is the one that says Problemas.
 * The same shape the recent list uses, and for the same reason.
 */
export const TOGGLE_PANEL_PREFIX = 'layout.togglePanel:';
export const togglePanelCommandId = (panelId: string): string => `${TOGGLE_PANEL_PREFIX}${panelId}`;
export const panelOfToggleCommand = (id: string): string | undefined =>
  id.startsWith(TOGGLE_PANEL_PREFIX) ? id.slice(TOGGLE_PANEL_PREFIX.length) : undefined;

/**
 * Hiding and showing a whole area, as a command per area (TYTO-248, ADR 0076): what the
 * status bar's three area buttons run, and what a person can bind in `keybindings.json`.
 */
export const TOGGLE_DOCK_PREFIX = 'layout.toggleDock:';
export const toggleDockCommandId = (dock: HideableDock): string => `${TOGGLE_DOCK_PREFIX}${dock}`;

export const EDITOR_OPEN = 'editor.open';
export const EDITOR_SAVE_AS = 'editor.saveAs';
/** E9.4. Opens the export dialog; the exporting itself is main's. */
export const FILE_EXPORT = 'file.export';
/** TYTO-47. Shows the plugins screen; installing one is the CLI's (`tyto plugin install`). */
export const PLUGINS_SHOW = 'plugins.show';
/** TYTO-45. Opens the local queue panel, or brings it forward when it is already open. */
export const QUEUE_SHOW = 'queue.show';
/** TYTO-206. Opens `settings.json` in a tab, or brings its tab forward. */
export const SETTINGS_OPEN = 'settings.open';
/** TYTO-207. Opens `keybindings.json` in a tab, or brings its tab forward. */
export const KEYBINDINGS_OPEN = 'keybindings.open';
/** TYTO-277. Opens `snippets.json` in a tab, or brings its tab forward. No key by default. */
export const SNIPPETS_OPEN = 'snippets.open';
/**
 * TYTO-113. Reloads the window, after writing the session so every tab comes back (ADR 0080).
 * Written here and on View in `shared/commands.ts`, pinned together by `commands.test.ts`.
 */
export const WINDOW_RELOAD = 'window.reload';
/**
 * TYTO-272 (ADR 0099). The window's zoom, a step at a time, each step written to the `zoom`
 * setting by main. On View in `shared/commands.ts` and pinned there by `commands.test.ts`.
 */
export const WINDOW_ZOOM_IN = 'window.zoomIn';
export const WINDOW_ZOOM_OUT = 'window.zoomOut';
export const WINDOW_ZOOM_RESET = 'window.zoomReset';
/**
 * TYTO-318. Help > Documentation: the user manual in the system browser, in the window's
 * language. On Help in `shared/commands.ts` and pinned there by `commands.test.ts`.
 */
export const HELP_OPEN_DOCUMENTATION = 'help.openDocumentation';
/**
 * TYTO-377 (ADR 0148). Runs the recipe in front to its end: the person's approval, so it runs in
 * a folder not trusted and it runs sources. Offered only with a recipe in front.
 */
export const RECIPE_RUN = 'recipe.run';
/**
 * TYTO-377 (ADR 0148). Run from here as a command: from the cell at or above the cursor down, and
 * Run recipe again fetching every source anew. Both are Run, the person's approval; offered only
 * with a recipe in front.
 */
export const RECIPE_RUN_FROM_CELL = 'recipe.runFromCell';
export const RECIPE_RUN_FRESH = 'recipe.runFresh';
/**
 * TYTO-208. "Preferences: Color Theme": the themes in the bar, previewed as the selection
 * moves, written to the `theme` setting on Enter. No key by default (ADR 0074): a person
 * binds one in `keybindings.json` if they switch often.
 */
export const THEME_PICK = 'theme.pick';
/**
 * TYTO-122. Points the app at a folder of templates, or goes back to the built-in pack.
 *
 * Two commands and not one toggle, because a toggle would have to say which state it is in
 * and the bar lists a verb. No keybinding either: this is a setting somebody changes once,
 * not a key anybody presses.
 */
export const TEMPLATES_CHOOSE_FOLDER = 'templates.chooseFolder';
export const TEMPLATES_CLEAR_FOLDER = 'templates.clearFolder';
/**
 * TYTO-278. Opens a workspace folder with main's picker, or closes the one open (ADR 0113).
 * Two commands, for the template folder's reason; both on the File menu.
 */
export const WORKSPACE_OPEN_FOLDER = 'workspace.openFolder';
export const WORKSPACE_CLOSE_FOLDER = 'workspace.closeFolder';
/**
 * TYTO-487. The title bar's recent folders popover, from a key or the bar: bindable in
 * `keybindings.json`, with no default key. A folder chosen opens as Open Folder opens one.
 */
export const WORKSPACE_OPEN_RECENT = 'workspace.openRecent';
/** TYTO-278. The open folder's trust, in a small dialog of its own (ADR 0111). */
export const WORKSPACE_MANAGE_TRUST = 'workspace.manageTrust';
/**
 * TYTO-433. Fetches what the plugin files name, in main (ADR 0151 decision 3): the sync
 * fetches only what the cache lacks, the update moves every ref to where it is now.
 */
export const PLUGIN_FILES_SYNC = 'pluginFiles.sync';
export const PLUGIN_FILES_UPDATE = 'pluginFiles.update';
/**
 * TYTO-347. Opens the Project panel: where each place came from (ADR 0114). Open and not
 * toggle, for `queue.show`'s reason; the trust strip's third button runs it too.
 */
export const WORKSPACE_SHOW_PROJECT = 'workspace.showProject';
/**
 * TYTO-44. The template mode: open a template folder to edit, or scaffold a new one.
 *
 * Two verbs for the File menu's reason — the bar lists what a person can do, and "edit" and
 * "make" are different things to want. `template.new` opens the mode on its name field rather
 * than asking in a box, because the mode is where the new template is going to be written.
 */
export const TEMPLATE_EDIT = 'template.edit';
export const TEMPLATE_NEW = 'template.new';
/**
 * A recent file, as a command per entry (E9.8).
 *
 * The path is in the id, which is what lets the bar list ten of them without a second kind
 * of row and without the registry learning what a file is. `@tyto/editor`'s convention is a
 * namespaced id and this keeps it; the part after the prefix is opaque to everything except
 * the handler that reopens it.
 */
export const RECENT_PREFIX = 'file.recent:';
export const recentCommandId = (path: string): string => `${RECENT_PREFIX}${path}`;
export const pathOfRecentCommand = (id: string): string | undefined =>
  id.startsWith(RECENT_PREFIX) ? id.slice(RECENT_PREFIX.length) : undefined;
/**
 * An export preset, as a command per preset (TYTO-270, ADR 0126): `keybindings.json` takes no
 * arguments, so a key names one preset by naming its command. The name follows the prefix as
 * the project file wrote it, and the bar puts `command.export.preset` in front.
 */
export const EXPORT_PRESET_PREFIX = 'export.preset:';
export const presetCommandId = (name: string): string => `${EXPORT_PRESET_PREFIX}${name}`;
export const presetOfCommand = (id: string): string | undefined =>
  id.startsWith(EXPORT_PRESET_PREFIX) ? id.slice(EXPORT_PRESET_PREFIX.length) : undefined;
export const EDITOR_TOGGLE_VIM = 'editor.toggleVim';
/**
 * The "/" menu without typing "/" (TYTO-276): the templates at the cursor, for a binding in
 * `keybindings.json`. No key by default — `Mod-/` is the comment toggle — and brief-only, because
 * the menu inserts into a brief and an app file's language never offers it.
 */
export const EDITOR_INSERT_MENU = 'editor.insertMenu';
/**
 * "Go to Block…" (TYTO-296): the brief's blocks in the bar, VS Code's "Go to Symbol in Editor".
 * `Mod-Shift-o`, its key there; brief-only and a text command, like the "/" menu, since it reads
 * the brief in the focused pane.
 */
export const EDITOR_GO_TO_BLOCK = 'editor.goToBlock';
/**
 * "Format Brief" (TYTO-297, ADR 0096): indentation, trailing spaces and repeated blank lines put
 * right in the focused pane's brief, as one undoable change. `Alt-Shift-f`, VS Code's "Format
 * Document" key; brief-only and a text command, like Go to Block.
 */
export const EDITOR_FORMAT_BRIEF = 'editor.formatBrief';

/**
 * A new, empty tab (TYTO-124).
 *
 * The only way to reach an empty buffer before this was to close the last tab, which the
 * window replaces with a fresh one — a side effect standing in for a verb. It registers next
 * to Open rather than beside the tab commands because that is where a person looks for it,
 * and registration order is display order.
 */
export const DOCUMENT_NEW = 'document.new';
/**
 * A new tab holding a template's skeleton (TYTO-275): the templates in the bar, and the one
 * chosen opens with its required slots written as fields Tab walks. Not brief-only — it opens a
 * tab of its own, whatever is in front — and no key by default (ADR 0074).
 */
export const DOCUMENT_NEW_FROM_TEMPLATE = 'document.newFromTemplate';
/**
 * A new delivery in the open folder (TYTO-489, ADR 0157): its name and a template asked in the
 * bar, the folder made by main, the brief opened. Offered only with a folder open; no key by
 * default, bindable in `keybindings.json`.
 */
export const DELIVERY_NEW = 'delivery.new';
/**
 * TYTO-496. The command panel's two entries in the command bar: put the caret on its prompt, and
 * write `render` with the brief in front on it, to run with Enter or add options to first.
 */
export const COMMAND_PANEL_RUN = 'commandPanel.run';
export const COMMAND_PANEL_RENDER_BRIEF = 'commandPanel.renderBrief';
/**
 * TYTO-497 (ADR 0164 decision 7). A new terminal, in front in the Terminal tab, which opens if it
 * was closed: Ctrl+Shift+`, VS Code's key for it, while Ctrl+` stays the command panel's.
 */
export const TERMINAL_NEW = 'terminal.new';
/**
 * The export of the delivery the brief in front belongs to (TYTO-490, ADR 0157 §6): no dialog to
 * fill, main resolves the folders, and the export box opens already running. Offered only for a
 * brief in a delivery; no key by default, bindable in `keybindings.json`.
 */
export const DELIVERY_EXPORT = 'delivery.export';
export const DOCUMENT_CLOSE = 'document.close';
export const DOCUMENT_NEXT = 'document.next';
export const DOCUMENT_PREVIOUS = 'document.previous';

/**
 * The editor groups (TYTO-286, ADR 0083). The two splits are `@tyto/editor`'s ids, so vim's
 * `:vsplit` and `:split` name them; moving focus between groups is the window's alone.
 */
export const GROUP_FOCUS_NEXT = 'editor.focusNextGroup';
export const GROUP_FOCUS_PREVIOUS = 'editor.focusPreviousGroup';
export const GROUP_MOVE_TAB_NEXT = 'editor.moveTabToNextGroup';
/** TYTO-288. The tab in front one place along its own strip, as a drag would put it. */
export const GROUP_MOVE_TAB_LEFT = 'editor.moveTabLeft';
export const GROUP_MOVE_TAB_RIGHT = 'editor.moveTabRight';
export const GROUP_CLOSE = 'editor.closeGroup';
export { EDITOR_SPLIT_DOWN, EDITOR_SPLIT_RIGHT };

/**
 * Going to the nth tab, as a command per slot (E9.11).
 *
 * Nine ids and not one command taking a number, for the reason the panel toggles and the
 * recent list already give: the bar runs an id and nothing else, so a person typing a file
 * name has to find a row that says it. `main.ts` registers one of these per **open**
 * document and takes them down again, so the bar lists the tabs that exist rather than nine
 * rows of which seven do nothing — and the keystroke is attached to the slot rather than to
 * the document, because `Mod-2` means "the second tab" whatever is in it.
 */
export const DOCUMENT_SELECT_PREFIX = 'document.select:';
export const DOCUMENT_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const selectDocumentCommandId = (slot: number): string =>
  `${DOCUMENT_SELECT_PREFIX}${String(slot)}`;
export const slotOfSelectCommand = (id: string): number | undefined => {
  if (!id.startsWith(DOCUMENT_SELECT_PREFIX)) return undefined;
  const slot = Number.parseInt(id.slice(DOCUMENT_SELECT_PREFIX.length), 10);
  return Number.isNaN(slot) ? undefined : slot;
};

/**
 * The catalogue key each command is shown under.
 *
 * Not the `label` on the command itself, which is where a reader would look first. That
 * field is a plain string and `@tyto/editor` is a package with no locale — its two built-in
 * commands, `editor.undo` and `editor.redo`, carry English labels written where no
 * catalogue exists. Translating at the point of display keeps the registry the same object
 * in both languages, and a registry that had to be rebuilt to change language would be the
 * wrong shape for something plugins will register into.
 *
 * A command with no entry here falls back to its own `label`, and then to its id. That is
 * deliberate rather than defensive: a plugin's command will land in exactly that case, and
 * showing its id is better than hiding it.
 */
export const COMMAND_LABELS: Readonly<Record<string, CatalogueKey>> = {
  [EDITOR_UNDO]: 'command.undo',
  [EDITOR_REDO]: 'command.redo',
  [PREVIEW_ZOOM_IN]: 'command.preview.zoomIn',
  [PREVIEW_ZOOM_OUT]: 'command.preview.zoomOut',
  [PREVIEW_ZOOM_FIT]: 'command.preview.zoomFit',
  [PREVIEW_NEXT_FORMAT]: 'command.preview.nextFormat',
  [PREVIEW_PREVIOUS_FORMAT]: 'command.preview.previousFormat',
  [PREVIEW_NEXT_SLIDE]: 'command.preview.nextSlide',
  [PREVIEW_PREVIOUS_SLIDE]: 'command.preview.previousSlide',
  [PREVIEW_OPEN_TO_SIDE]: 'command.preview.openToSide',
  [PREVIEW_OPEN]: 'command.preview.open',
  [PREVIEW_TOGGLE_LOCK]: 'command.preview.toggleLock',
  [PREVIEW_SHOW_ONE_SLIDE]: 'command.preview.showOneSlide',
  [PREVIEW_SHOW_ALL_SLIDES]: 'command.preview.showAllSlides',
  [SHELL_TOGGLE_LOCALE]: 'command.shell.toggleLocale',
  [EDITOR_TOGGLE_VIM]: 'command.editor.toggleVim',
  [EDITOR_INSERT_MENU]: 'command.editor.insertMenu',
  [EDITOR_GO_TO_BLOCK]: 'command.editor.goToBlock',
  [EDITOR_FORMAT_BRIEF]: 'command.editor.formatBrief',
  [DOCUMENT_NEW]: 'command.document.new',
  [DOCUMENT_NEW_FROM_TEMPLATE]: 'command.document.newFromTemplate',
  [DELIVERY_NEW]: 'command.delivery.new',
  [COMMAND_PANEL_RUN]: 'command.commandPanel.run',
  [COMMAND_PANEL_RENDER_BRIEF]: 'command.commandPanel.renderBrief',
  [TERMINAL_NEW]: 'command.terminal.new',
  [DELIVERY_EXPORT]: 'command.delivery.export',
  [EDITOR_OPEN]: 'command.file.open',
  [EDITOR_SAVE]: 'command.file.save',
  [EDITOR_SAVE_AS]: 'command.file.saveAs',
  [FILE_EXPORT]: 'command.file.export',
  [PLUGINS_SHOW]: 'command.plugins.show',
  [QUEUE_SHOW]: 'command.queue.show',
  [SETTINGS_OPEN]: 'command.settings.open',
  [KEYBINDINGS_OPEN]: 'command.keybindings.open',
  [SNIPPETS_OPEN]: 'command.snippets.open',
  [WINDOW_RELOAD]: 'command.window.reload',
  [WINDOW_ZOOM_IN]: 'command.window.zoomIn',
  [WINDOW_ZOOM_OUT]: 'command.window.zoomOut',
  [WINDOW_ZOOM_RESET]: 'command.window.zoomReset',
  [HELP_OPEN_DOCUMENTATION]: 'command.help.openDocumentation',
  [RECIPE_RUN]: 'command.recipe.run',
  [RECIPE_RUN_FROM_CELL]: 'command.recipe.runFromCell',
  [RECIPE_RUN_FRESH]: 'command.recipe.runFresh',
  [THEME_PICK]: 'command.theme.pick',
  [TEMPLATES_CHOOSE_FOLDER]: 'command.templates.chooseFolder',
  [TEMPLATES_CLEAR_FOLDER]: 'command.templates.clearFolder',
  [WORKSPACE_OPEN_FOLDER]: 'command.workspace.openFolder',
  [WORKSPACE_CLOSE_FOLDER]: 'command.workspace.closeFolder',
  [WORKSPACE_OPEN_RECENT]: 'command.workspace.openRecent',
  [WORKSPACE_MANAGE_TRUST]: 'command.workspace.manageTrust',
  [PLUGIN_FILES_SYNC]: 'command.pluginFiles.sync',
  [PLUGIN_FILES_UPDATE]: 'command.pluginFiles.update',
  [WORKSPACE_SHOW_PROJECT]: 'command.workspace.showProject',
  [TEMPLATE_EDIT]: 'command.template.edit',
  [TEMPLATE_NEW]: 'command.template.new',
  [LAYOUT_RESTORE]: 'command.layout.restore',
  [toggleDockCommandId('left')]: 'command.layout.toggleDock.left',
  [toggleDockCommandId('bottom')]: 'command.layout.toggleDock.bottom',
  [toggleDockCommandId('right')]: 'command.layout.toggleDock.right',
  [DOCUMENT_CLOSE]: 'command.document.close',
  [DOCUMENT_NEXT]: 'command.document.next',
  [DOCUMENT_PREVIOUS]: 'command.document.previous',
  [EDITOR_SPLIT_RIGHT]: 'command.group.splitRight',
  [EDITOR_SPLIT_DOWN]: 'command.group.splitDown',
  [GROUP_FOCUS_NEXT]: 'command.group.focusNext',
  [GROUP_FOCUS_PREVIOUS]: 'command.group.focusPrevious',
  [GROUP_MOVE_TAB_NEXT]: 'command.group.moveTabToNext',
  [GROUP_MOVE_TAB_LEFT]: 'command.group.moveTabLeft',
  [GROUP_MOVE_TAB_RIGHT]: 'command.group.moveTabRight',
  [GROUP_CLOSE]: 'command.group.close',
  // The six `@tyto/editor` brings with the search panel (E8.5). Their ids and their English
  // labels are the editor's, the same as undo and redo above; what this table adds is the
  // catalogue key, so the bar shows them in the window's language.
  [EDITOR_FIND]: 'command.editor.find',
  [EDITOR_FIND_NEXT]: 'command.editor.findNext',
  [EDITOR_FIND_PREVIOUS]: 'command.editor.findPrevious',
  [EDITOR_REPLACE_NEXT]: 'command.editor.replaceNext',
  [EDITOR_REPLACE_ALL]: 'command.editor.replaceAll',
  [EDITOR_GOTO_LINE]: 'command.editor.gotoLine',
};

/**
 * What `main.ts` has to be able to do for the commands below to mean anything.
 *
 * A port and not the module's own state: every one of these moves something `main.ts`
 * holds — the zoom, the selected format, the locale — and taking them as functions is what
 * lets a test drive the whole registry without a window, a bridge or an editor.
 */
export interface DesktopActions {
  /** TYTO-496. The command panel's tab in front, the caret on its prompt. */
  focusCommandPanel(): void;
  /** Opens another terminal in front, the Terminal tab with it (TYTO-497). */
  newTerminal(): void;
  /** TYTO-496. `render` and the brief in front written on the prompt, not run. */
  renderBriefInCommandPanel(): void;
  stepZoom(direction: 1 | -1): void;
  zoomToFit(): void;
  /** Wraps at the ends: a tab strip with two formats should cycle rather than stop. */
  stepFormat(direction: 1 | -1): void;
  stepSlide(direction: 1 | -1): void;
  /** TYTO-287. The following preview beside the brief (`side`) or in the focused group. */
  openPreview(side: boolean): void;
  /** TYTO-287. Locks the preview in front on its brief, or lets it follow again. */
  togglePreviewLock(): void;
  /** TYTO-323. One slide over the strip, or every slide in a grid, in the preview in front. */
  setPreviewMode(mode: 'one' | 'all'): void;
  toggleLocale(): void;
  toggleVimMode(): void;
  /** TYTO-276. Opens the "/" menu at the cursor, with no "/" typed. */
  openInsertMenu(): void;
  /** TYTO-296. The focused pane's blocks in the bar; the highlighted one is previewed. */
  goToBlock(): void;
  /** TYTO-297. Formats the focused pane's brief, or says why it cannot. */
  formatBrief(): void;
  /** E9.8. Each of these ends in a round trip to main, which owns every path. */
  newDocument(): void;
  /** TYTO-275. Lists the templates in the bar; the chosen one's skeleton opens in a new tab. */
  newDocumentFromTemplate(): void;
  /** TYTO-489. Asks the name and a template in the bar; main makes the delivery. */
  newDelivery(): void;
  /** TYTO-490. Exports the brief in front into its delivery; main resolves the folders. */
  exportDelivery(): void;
  openDocument(): void;
  saveDocument(saveAs: boolean): void;
  /** E9.10. Puts every panel back where ADR 0024 says it goes. */
  restoreLayout(): void;
  /** TYTO-248. Hides or shows one area whole; `shared/layout.ts` says what that means. */
  toggleDock(dock: HideableDock): void;
  /** E9.11. Closing asks first when the tab has unsaved text, so it answers nothing here. */
  closeDocument(): void;
  stepDocument(direction: 1 | -1): void;
  /** TYTO-286. A new group beside (`row`) or under (`column`) the focused one, same document. */
  splitGroup(direction: 'row' | 'column'): void;
  /** TYTO-286. Focus to the group before or after the focused one, wrapping at the ends. */
  focusGroup(direction: 1 | -1): void;
  /** TYTO-286. The tab in front to the next group; with one group, into a new split right. */
  moveTabToNextGroup(): void;
  /** TYTO-288. The tab in front one place left or right in its strip, stopping at the ends. */
  stepTabInGroup(direction: 1 | -1): void;
  /** TYTO-286. Closes every tab of the focused group as `Mod-w` would, asking when unsaved. */
  closeGroup(): void;
  /** E9.4. Shows the export dialog. Everything it then does is a round trip to main. */
  openExport(): void;
  /** TYTO-47. Shows the plugins screen; the list is a round trip to main. */
  showPlugins(): void;
  /**
   * TYTO-45. Opens the queue panel. Open and not toggle, unlike the panel's own
   * `layout.togglePanel:queue`: a menu item called "Show the local queue" that hid it the
   * second time would be a menu item that lies.
   */
  showQueue(): void;
  openSettings(): void;
  openKeybindings(): void;
  openSnippets(): void;
  /** TYTO-113. Keeps the session, then reloads: nothing open is lost (ADR 0080). */
  reloadWindow(): void;
  /** TYTO-272. Steps the window's zoom; main applies it and writes the `zoom` setting. */
  zoomWindow(step: 'in' | 'out' | 'reset'): void;
  /** TYTO-318. Asks main to open the manual; which edition, and its address, are main's. */
  openDocumentation(): void;
  /** TYTO-377. Runs the recipe in front with `explicit`; the run itself is main's. */
  runRecipe(): void;
  /** TYTO-377. Runs the recipe in front from the cursor's cell down, with `explicit`. */
  runRecipeFromCell(): void;
  /** TYTO-377. Runs the recipe in front with `fresh` and `explicit`: every source fetches. */
  runRecipeFresh(): void;
  /** TYTO-208. Lists the colour themes in the bar; the list and the choice are main's. */
  pickTheme(): void;
  /**
   * TYTO-122. Points the app at a folder of templates, or clears the choice.
   *
   * Both end in a round trip to main the way `openDocument` does, and for the same reason:
   * the picker is an Electron dialog and the folder is read from a disk, and neither is the
   * window's.
   */
  chooseTemplateFolder(): void;
  clearTemplateFolder(): void;
  openWorkspaceFolder(): void;
  /** TYTO-487. Opens the recent folders popover under the title bar's folder button. */
  openRecentFolders(): void;
  closeWorkspaceFolder(): void;
  manageTrust(): void;
  /** TYTO-433. Syncs the plugin files; `update` moves every ref. */
  syncPluginFiles(update: boolean): void;
  /** TYTO-347. Opens the Project panel beside Problems. */
  showProject(): void;
  /** TYTO-44. Both open the template mode; what happens in it is a round trip to main. */
  editTemplate(): void;
  newTemplate(): void;
}

/**
 * The registry, with the window's own commands in it.
 *
 * **None of them declares an `undo`**, and the registry would accept one: the field exists
 * for a command that changes something the document does not hold, which is exactly what a
 * zoom is. It is left off on purpose. `Mod-z` is one stack shared with the text, so a
 * declared undo would put "I zoomed in" between two keystrokes a person is trying to take
 * back — and an undo that sometimes moves the picture instead of the words is worse than no
 * undo at all for these. Changing the zoom back is one keystroke either way.
 *
 * Registration order is display order (`@tyto/editor`), so this reads top to bottom the way
 * the bar shows it: undo and redo arrive first, from `createCommandRegistry` itself.
 */
export function createDesktopRegistry(actions: DesktopActions): CommandRegistry {
  const registry = createCommandRegistry();

  const add = (id: string, run: () => void): void => {
    registry.register({ id, run });
  };

  add(PREVIEW_ZOOM_IN, () => {
    actions.stepZoom(1);
  });
  add(PREVIEW_ZOOM_OUT, () => {
    actions.stepZoom(-1);
  });
  add(PREVIEW_ZOOM_FIT, () => {
    actions.zoomToFit();
  });
  add(PREVIEW_NEXT_FORMAT, () => {
    actions.stepFormat(1);
  });
  add(PREVIEW_PREVIOUS_FORMAT, () => {
    actions.stepFormat(-1);
  });
  add(PREVIEW_NEXT_SLIDE, () => {
    actions.stepSlide(1);
  });
  add(PREVIEW_PREVIOUS_SLIDE, () => {
    actions.stepSlide(-1);
  });
  add(PREVIEW_OPEN_TO_SIDE, () => {
    actions.openPreview(true);
  });
  add(PREVIEW_OPEN, () => {
    actions.openPreview(false);
  });
  add(PREVIEW_TOGGLE_LOCK, () => {
    actions.togglePreviewLock();
  });
  add(PREVIEW_SHOW_ONE_SLIDE, () => {
    actions.setPreviewMode('one');
  });
  add(PREVIEW_SHOW_ALL_SLIDES, () => {
    actions.setPreviewMode('all');
  });
  add(SHELL_TOGGLE_LOCALE, () => {
    actions.toggleLocale();
  });
  add(EDITOR_TOGGLE_VIM, () => {
    actions.toggleVimMode();
  });
  add(EDITOR_INSERT_MENU, () => {
    actions.openInsertMenu();
  });
  add(EDITOR_GO_TO_BLOCK, () => {
    actions.goToBlock();
  });
  add(EDITOR_FORMAT_BRIEF, () => {
    actions.formatBrief();
  });

  // `editor.save` is `@tyto/editor`'s id and not one invented here, which is the whole
  // point: the editor has shipped `Mod-s` bound to that string since E8.3, and until a host
  // registered it the key did nothing. This is the host registering it.
  add(DOCUMENT_NEW, () => {
    actions.newDocument();
  });
  add(DOCUMENT_NEW_FROM_TEMPLATE, () => {
    actions.newDocumentFromTemplate();
  });
  add(DELIVERY_NEW, () => {
    actions.newDelivery();
  });
  add(COMMAND_PANEL_RUN, () => {
    actions.focusCommandPanel();
  });
  add(COMMAND_PANEL_RENDER_BRIEF, () => {
    actions.renderBriefInCommandPanel();
  });
  add(TERMINAL_NEW, () => {
    actions.newTerminal();
  });
  add(DELIVERY_EXPORT, () => {
    actions.exportDelivery();
  });
  add(EDITOR_OPEN, () => {
    actions.openDocument();
  });
  add(EDITOR_SAVE, () => {
    actions.saveDocument(false);
  });
  add(EDITOR_SAVE_AS, () => {
    actions.saveDocument(true);
  });

  add(FILE_EXPORT, () => {
    actions.openExport();
  });
  add(PLUGINS_SHOW, () => {
    actions.showPlugins();
  });
  add(QUEUE_SHOW, () => {
    actions.showQueue();
  });
  add(SETTINGS_OPEN, () => {
    actions.openSettings();
  });
  add(KEYBINDINGS_OPEN, () => {
    actions.openKeybindings();
  });
  add(SNIPPETS_OPEN, () => {
    actions.openSnippets();
  });
  add(WINDOW_RELOAD, () => {
    actions.reloadWindow();
  });
  add(WINDOW_ZOOM_IN, () => {
    actions.zoomWindow('in');
  });
  add(WINDOW_ZOOM_OUT, () => {
    actions.zoomWindow('out');
  });
  add(WINDOW_ZOOM_RESET, () => {
    actions.zoomWindow('reset');
  });
  add(HELP_OPEN_DOCUMENTATION, () => {
    actions.openDocumentation();
  });
  add(RECIPE_RUN, () => {
    actions.runRecipe();
  });
  add(RECIPE_RUN_FROM_CELL, () => {
    actions.runRecipeFromCell();
  });
  add(RECIPE_RUN_FRESH, () => {
    actions.runRecipeFresh();
  });
  add(THEME_PICK, () => {
    actions.pickTheme();
  });

  // Registration order is display order, so these land next to Export rather than at the
  // bottom of a list of zoom levels.
  add(TEMPLATES_CHOOSE_FOLDER, () => {
    actions.chooseTemplateFolder();
  });

  add(TEMPLATES_CLEAR_FOLDER, () => {
    actions.clearTemplateFolder();
  });

  add(WORKSPACE_OPEN_FOLDER, () => {
    actions.openWorkspaceFolder();
  });

  add(WORKSPACE_OPEN_RECENT, () => {
    actions.openRecentFolders();
  });

  add(WORKSPACE_CLOSE_FOLDER, () => {
    actions.closeWorkspaceFolder();
  });

  add(WORKSPACE_MANAGE_TRUST, () => {
    actions.manageTrust();
  });

  add(PLUGIN_FILES_SYNC, () => {
    actions.syncPluginFiles(false);
  });

  add(PLUGIN_FILES_UPDATE, () => {
    actions.syncPluginFiles(true);
  });

  add(WORKSPACE_SHOW_PROJECT, () => {
    actions.showProject();
  });

  add(TEMPLATE_EDIT, () => {
    actions.editTemplate();
  });
  add(TEMPLATE_NEW, () => {
    actions.newTemplate();
  });

  // Reachable with every panel closed, which is the acceptance criterion and the reason it
  // is a command rather than a button on a panel: the state a person most needs this in is
  // the one where there is nothing left to click.
  add(LAYOUT_RESTORE, () => {
    actions.restoreLayout();
  });
  for (const dock of ['left', 'bottom', 'right'] as const) {
    add(toggleDockCommandId(dock), () => {
      actions.toggleDock(dock);
    });
  }

  add(DOCUMENT_CLOSE, () => {
    actions.closeDocument();
  });
  add(DOCUMENT_NEXT, () => {
    actions.stepDocument(1);
  });
  add(DOCUMENT_PREVIOUS, () => {
    actions.stepDocument(-1);
  });
  add(EDITOR_SPLIT_RIGHT, () => {
    actions.splitGroup('row');
  });
  add(EDITOR_SPLIT_DOWN, () => {
    actions.splitGroup('column');
  });
  add(GROUP_FOCUS_NEXT, () => {
    actions.focusGroup(1);
  });
  add(GROUP_FOCUS_PREVIOUS, () => {
    actions.focusGroup(-1);
  });
  add(GROUP_MOVE_TAB_NEXT, () => {
    actions.moveTabToNextGroup();
  });
  add(GROUP_MOVE_TAB_LEFT, () => {
    actions.stepTabInGroup(-1);
  });
  add(GROUP_MOVE_TAB_RIGHT, () => {
    actions.stepTabInGroup(1);
  });
  add(GROUP_CLOSE, () => {
    actions.closeGroup();
  });

  return registry;
}

/**
 * The commands that act on the brief in front, and on nothing else (TYTO-283).
 *
 * Decided from the running app with `settings.json` in front, not from the names: export opened
 * its dialog and wrote the JSON out as `<name>.json.brief` beside a `result.json` of syntax
 * errors; the zoom, format and slide steps moved state the hidden preview controls hold. The
 * template mode's two verbs are not here: they open a template folder, whatever tab is in
 * front.
 */
export const BRIEF_ONLY_COMMANDS: ReadonlySet<string> = new Set([
  PREVIEW_ZOOM_IN,
  PREVIEW_ZOOM_OUT,
  PREVIEW_ZOOM_FIT,
  PREVIEW_NEXT_FORMAT,
  PREVIEW_PREVIOUS_FORMAT,
  PREVIEW_NEXT_SLIDE,
  PREVIEW_PREVIOUS_SLIDE,
  PREVIEW_OPEN_TO_SIDE,
  PREVIEW_OPEN,
  PREVIEW_TOGGLE_LOCK,
  PREVIEW_SHOW_ONE_SLIDE,
  PREVIEW_SHOW_ALL_SLIDES,
  FILE_EXPORT,
  DELIVERY_EXPORT,
  EDITOR_INSERT_MENU,
  EDITOR_GO_TO_BLOCK,
  EDITOR_FORMAT_BRIEF,
]);

/** Whether `id` acts on the brief in front: one of the set, or an export preset (TYTO-270). */
export const isBriefOnlyCommand = (id: string): boolean =>
  BRIEF_ONLY_COMMANDS.has(id) || presetOfCommand(id) !== undefined;

/**
 * The commands that act on the text in front, which a preview tab has none of (TYTO-287): with
 * a preview focused its group's CodeMirror pane is hidden and shows nothing, so undo, find or
 * the "/" menu there would act on an empty view. Save and export are not here — a preview
 * saves and exports its brief, as VS Code's does.
 */
export const TEXT_COMMANDS: ReadonlySet<string> = new Set([
  EDITOR_UNDO,
  EDITOR_REDO,
  EDITOR_FIND,
  EDITOR_FIND_NEXT,
  EDITOR_FIND_PREVIOUS,
  EDITOR_REPLACE_NEXT,
  EDITOR_REPLACE_ALL,
  EDITOR_GOTO_LINE,
  EDITOR_INSERT_MENU,
  EDITOR_GO_TO_BLOCK,
  EDITOR_FORMAT_BRIEF,
]);

/**
 * The registry, with `run` refusing what `offered` says no to (TYTO-283).
 *
 * At `run` and not at each command's action, because `run` is the one door every caller shares:
 * the bar, the editor's keymap (through the registry facet), the window's dispatcher, the status
 * bar and the File menu's `command:run`. A refused id answers `false`, exactly as an id nobody
 * registered does, so a key bound to it falls through to whatever binds it below — VS Code's
 * answer for a binding whose `when` does not hold. `list` is left whole on purpose: the
 * keybindings resolver checks ids against it, and an id that vanished with `settings.json` in
 * front would turn every binding to it into `W_KEYBINDING_UNKNOWN_COMMAND` there.
 */
export function withCommandGate(
  registry: CommandRegistry,
  offered: (id: string) => boolean,
): CommandRegistry {
  return {
    ...registry,
    run: (id, context) => offered(id) && registry.run(id, context),
  };
}

/** Moved to `@tyto/editor` with the table it reads (TYTO-207); re-exported for the window. */
export { bindingsOf };

/**
 * The default set plus the two keys only a desktop can mean.
 *
 * `Mod-s` is already in both of `@tyto/editor`'s sets — the editor ships the binding and
 * leaves the command to the host — so new, open and "save as" are the three this adds.
 * They go in a set rather than in a window listener because they are about the document and
 * the editor is what owns one; `Mod-K` is the opposite case and is a global binding, run by
 * the window's dispatcher for the opposite reason (`main.ts`).
 *
 * **`Mod-n` is here and not on the File menu item, which is the rule for all five verbs**
 * (TYTO-124). A menu accelerator is the browser process's and fires before the page, so it
 * would override this set unconditionally — vim mode included, where these bindings are
 * deliberately absent and `Ctrl-N` and `Ctrl-O` belong to the vim engine. `src/main/menu.ts`
 * carries the reasoning where somebody would go to add one.
 */
export const desktopKeymapSet: EditorKeymap = {
  id: 'desktop',
  bindings: [
    ...defaultKeymapSet.bindings,
    { key: 'Mod-n', command: DOCUMENT_NEW },
    { key: 'Mod-o', command: EDITOR_OPEN },
    { key: 'Mod-Shift-s', command: EDITOR_SAVE_AS },
    // The tabs (E9.11). `Mod-w` closes and the two page keys step, which is what Chrome,
    // Firefox and VS Code all bind on Windows and Linux; `Mod-1`…`Mod-9` go straight to a
    // slot. They are here rather than in a window listener of their own because the card
    // asks for one table: the bar reads its keystrokes off this set, so a binding invented
    // beside it would be a shortcut the palette does not know about.
    { key: 'Mod-w', command: DOCUMENT_CLOSE },
    // TYTO-113. Back since the session makes a reload lose nothing (ADR 0080). Here and not
    // on the menu item, so vim keeps `Ctrl-R` for redo.
    { key: 'Mod-r', command: WINDOW_RELOAD },
    { key: 'Mod-PageDown', command: DOCUMENT_NEXT },
    { key: 'Mod-PageUp', command: DOCUMENT_PREVIOUS },
    // TYTO-288. VS Code's keys for moving the tab in front along its strip; free in
    // CodeMirror's keymaps, whose page keys take Shift alone.
    { key: 'Mod-Shift-PageUp', command: GROUP_MOVE_TAB_LEFT },
    { key: 'Mod-Shift-PageDown', command: GROUP_MOVE_TAB_RIGHT },
    // TYTO-286. VS Code's split key; `Mod-Shift-\` takes CodeMirror's "go to the matching
    // bracket" in this set, which a brief has little use for. Vim splits with `:vsplit`.
    { key: 'Mod-\\', command: EDITOR_SPLIT_RIGHT },
    { key: 'Mod-Shift-\\', command: EDITOR_SPLIT_DOWN },
    { key: 'Mod-Alt-ArrowLeft', command: GROUP_FOCUS_PREVIOUS },
    { key: 'Mod-Alt-ArrowRight', command: GROUP_FOCUS_NEXT },
    ...DOCUMENT_SLOTS.map((slot) => ({
      key: `Mod-${String(slot)}`,
      command: selectDocumentCommandId(slot),
    })),
  ],
};

/**
 * The built-in layer of the window's one keybinding table (TYTO-207, ADR 0074).
 *
 * The same three sets as before, now with the context each one was always in. `vimKeymapSet`
 * is `editor`, because save is bound in both input modes; the rest of the desktop
 * set is `mode.desktop`, because vim mode replaces it; and `Mod-K` is global, because the bar
 * opens wherever focus is. Plugins and, once the file exists, the person override this.
 */
export const builtInKeybindings: readonly Keybinding[] = [
  ...keybindingsOf(vimKeymapSet, 'editor'),
  ...keybindingsOf(desktopKeymapSet, 'mode.desktop').filter(
    (binding) =>
      !vimKeymapSet.bindings.some(
        (both) => both.key === binding.key && both.command === binding.command,
      ),
  ),
  { key: COMMAND_BAR_KEY, command: COMMAND_BAR_TOGGLE, source: 'built-in' },
  // TYTO-287. Global, like the bar's key: it answers with a preview focused, which no editor
  // context reaches. Free in CodeMirror's keymaps and in this table; Chromium's "paste as plain
  // text" on the same key is what VS Code gives up for it too.
  { key: 'Mod-Shift-v', command: PREVIEW_OPEN_TO_SIDE, source: 'built-in' },
  // TYTO-496. The command panel, on VS Code's terminal key: Ctrl and not Mod, on macOS too, as
  // VS Code binds it. Global, so it closes the panel from inside it and opens it from anywhere.
  // Free in this table, in CodeMirror's keymaps and in vim's engine.
  { key: 'Ctrl-`', command: togglePanelCommandId(COMMANDS_PANEL), source: 'built-in' },
  // TYTO-497 (ADR 0164 decision 7). A new terminal on VS Code's key for one, by the same physical
  // key (`windowStrokeOf`), so Shift with the key left of 1 reaches it on ABNT2 too. Global, so it
  // opens one from the editor and from inside another terminal. Free in this table, in
  // CodeMirror's keymaps and in vim's engine.
  { key: 'Ctrl-Shift-`', command: TERMINAL_NEW, source: 'built-in' },
  // TYTO-272 (ADR 0099). The keys every browser and VS Code zoom with, global like the two
  // above so they answer in vim, in a preview and in the settings tab alike. Electron's roles
  // held them before, from the browser process; the window's table holds them now. Free in
  // this table (the tab slots are 1 to 9), in CodeMirror's keymaps and in vim's engine.
  { key: 'Mod-=', command: WINDOW_ZOOM_IN, source: 'built-in' },
  { key: 'Mod--', command: WINDOW_ZOOM_OUT, source: 'built-in' },
  { key: 'Mod-0', command: WINDOW_ZOOM_RESET, source: 'built-in' },
  // TYTO-296. VS Code's "Go to Symbol in Editor" key, in both input modes. Free in this table,
  // in CodeMirror's keymaps and in vim, whose engine leaves Ctrl+Shift+O alone.
  { key: 'Mod-Shift-o', command: EDITOR_GO_TO_BLOCK, when: 'editor', source: 'built-in' },
  // TYTO-297. VS Code's "Format Document" key on Windows and Linux, in both input modes. Free in
  // this table, in CodeMirror's keymaps (which take Shift-Alt only with the arrows, `a` and,
  // on macOS, `m`) and in vim, whose engine binds no Alt key.
  { key: 'Alt-Shift-f', command: EDITOR_FORMAT_BRIEF, when: 'editor', source: 'built-in' },
];

export const builtInTable: KeybindingTable = { bindings: builtInKeybindings };

/**
 * A keydown as the window's key table reads it: `keyOfStroke`, except that **the physical key
 * left of 1 is always `` ` ``**, whatever the layout prints on it (TYTO-496). The command panel's
 * Ctrl+` is VS Code's terminal key, and VS Code matches it by position too. On a Brazilian ABNT2
 * keyboard that key prints `'`, and the backquote is a dead key elsewhere on the keyboard, so
 * reading `key` would leave the shortcut unreachable on the keyboard its maintainer types on.
 * A dead key itself (`Dead`, on another `code`) stays what it is and runs nothing.
 */
export function windowStrokeOf(event: KeyStroke & { readonly code: string }): string {
  if (event.code !== 'Backquote') return keyOfStroke(event);
  // The modifiers one by one: a `KeyboardEvent`'s fields are getters, which a spread drops.
  const { ctrlKey, metaKey, altKey, shiftKey } = event;
  return keyOfStroke({ key: '`', ctrlKey, metaKey, altKey, shiftKey });
}

/**
 * The set that is interpreting the keys right now, which vim mode changes.
 *
 * **Vim gets the plain set and not the extended one, and that is not an oversight.**
 * `vimMode()` in `@tyto/editor` replaces the whole input layer and brings its set with it, so
 * `Mod-o` and `Mod-Shift-s` are simply not bound while vim is on. The bar reads its keystrokes
 * off whatever this returns, so returning the extended set here would make it promise two
 * shortcuts that do nothing — which is worse than showing none, because a person would stop
 * looking for the command.
 */
export const keymapSetFor = (vim: boolean, table: KeybindingTable = builtInTable): EditorKeymap =>
  keymapSetOfTable(table, vim);

/**
 * A plugin's `editor.keymap` as a layer of the table.
 *
 * `when` wins; `mode` stands in for it in the plugins written before it existed — `normal`
 * was always the desktop's input mode, and `vim` the engine's normal mode, where a key that
 * is not a character is free. Neither means global, as a missing `when` does in the file.
 */
export function pluginKeybindingLayer(
  keymap: IpcResponse<'plugins:keymaps'>['keymaps'][number],
): KeybindingLayer {
  const when =
    keymap.when ??
    (keymap.mode === 'vim' ? 'vim.normal' : keymap.mode === 'normal' ? 'mode.desktop' : undefined);
  const entries: KeybindingEntry[] = Object.entries(keymap.bindings).map(([key, command]) => ({
    key,
    command,
    ...(when === undefined ? {} : { when }),
  }));
  return { entries };
}
