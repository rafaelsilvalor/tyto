/**
 * Which icon a file or folder gets, wherever the window names one (TYTO-282, ADR 0116): the
 * explorer's rows and the editor's tabs.
 *
 * **A pure function of a name, a kind and a flag main sends — never a path.** The window holds
 * no path (ADR 0010, ADR 0115), so whatever a name alone cannot tell is answered by main as a
 * `place`: the folder the project's `output` resolves to, a folder it names under `assets` or
 * `templates`, a folder directly inside a templates folder, and the project file itself. A
 * folder is never read to find out what it is.
 *
 * In `shared/` because it is one table both sides could name, and linted pure — no Node, no DOM.
 * The geometry is the window's (`renderer/icons.ts`); this only picks a name.
 */

/**
 * What main knows about an entry that its name does not say (ADR 0116 rule 2), in the order
 * main checks them: a folder that is two places at once is the first of them.
 */
export const EXPLORER_PLACES = ['output', 'templates', 'template', 'assets', 'project'] as const;

export type ExplorerPlace = (typeof EXPLORER_PLACES)[number];

export type FileIconName =
  | 'brief'
  | 'templateFolder'
  | 'templateHtml'
  | 'templateTs'
  | 'manifest'
  | 'image'
  | 'font'
  | 'json'
  | 'settingsFile'
  | 'keybindingsFile'
  | 'snippetsFile'
  | 'projectFile'
  | 'text'
  | 'folder'
  | 'folderOpen'
  | 'folderAssets'
  | 'folderOutput'
  | 'file';

export interface FileIconSubject {
  readonly name: string;
  readonly kind: 'folder' | 'brief' | 'file';
  readonly place?: ExplorerPlace | undefined;
  /** A folder's state on screen. Only a plain folder draws it; the chevron says it elsewhere. */
  readonly expanded?: boolean;
}

/** Files known by their whole name, compared case-insensitively. */
const BY_NAME: Readonly<Record<string, FileIconName>> = {
  'template.html': 'templateHtml',
  'template.ts': 'templateTs',
  'manifest.yaml': 'manifest',
  'manifest.yml': 'manifest',
  'settings.json': 'settingsFile',
  'keybindings.json': 'keybindingsFile',
  'snippets.json': 'snippetsFile',
};

/** Files known by their extension, after the whole name had its turn. */
const BY_EXTENSION: Readonly<Record<string, FileIconName>> = {
  brief: 'brief',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  svg: 'image',
  webp: 'image',
  gif: 'image',
  ttf: 'font',
  otf: 'font',
  woff: 'font',
  woff2: 'font',
  json: 'json',
  jsonc: 'json',
  md: 'text',
  txt: 'text',
};

/** A place's own icon. A file flagged `project` is the only file a place names. */
const BY_PLACE: Readonly<Record<ExplorerPlace, FileIconName>> = {
  output: 'folderOutput',
  templates: 'templateFolder',
  template: 'templateFolder',
  assets: 'folderAssets',
  project: 'projectFile',
};

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  // A leading dot is a hidden file's name, not an extension: `.env` has none.
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
};

export function fileIconFor(subject: FileIconSubject): FileIconName {
  if (subject.place !== undefined) return BY_PLACE[subject.place];
  const name = subject.name.toLowerCase();
  if (subject.kind === 'folder') {
    // `assets/` is a place by convention too: a brief's assets resolve in the `assets` beside
    // it whether or not the project names it (ADR 0056).
    if (name === 'assets') return 'folderAssets';
    return subject.expanded === true ? 'folderOpen' : 'folder';
  }
  if (subject.kind === 'brief') return 'brief';
  return BY_NAME[name] ?? BY_EXTENSION[extensionOf(name)] ?? 'file';
}

/**
 * Whether a click on a file of this name shows it in the preview (TYTO-366, ADR 0124): a PNG,
 * JPEG, WebP, GIF or SVG, by extension. The window only asks; main checks the bytes and answers
 * `unsupported` for a file that is not what its name says.
 */
export const isPreviewImage = (name: string): boolean =>
  ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extensionOf(name));

/**
 * What a file opens as in a tab (TYTO-247, ADR 0132): a brief, plain text, Markdown, or a recipe
 * (TYTO-377). Main names it from the path's extension at every open; the window never guesses it
 * from a name.
 */
export type DocumentFormat = 'brief' | 'text' | 'markdown' | 'recipe';

/** A format that is not a brief: a text file of one kind or another. */
type TextFormat = Exclude<DocumentFormat, 'brief'>;

/**
 * The text formats, and only these: `.json`, `.csv` and `.yaml` stay out (Rafael). `.recipe` is
 * the third (TYTO-377): text in a tab, which the recipe notebook runs instead of a compile.
 */
const TEXT_FORMATS: Readonly<Record<string, TextFormat>> = {
  txt: 'text',
  md: 'markdown',
  recipe: 'recipe',
};

/** The extensions a tab opens, with the dot, as the explorer and the dialogs ask for them. */
export const TAB_EXTENSIONS = ['.brief', '.txt', '.md', '.recipe'] as const;

/** The text format of a file of this name, or none. Own keys only: `x.constructor` is no text. */
const textFormatOf = (name: string): TextFormat | undefined => {
  const extension = extensionOf(name);
  return Object.prototype.hasOwnProperty.call(TEXT_FORMATS, extension)
    ? TEXT_FORMATS[extension]
    : undefined;
};

/**
 * Whether a click on a file of this name opens it in a tab as text (TYTO-247): `.txt`, `.md` and
 * `.recipe` (TYTO-377).
 */
export const isTextFile = (name: string): boolean => textFormatOf(name) !== undefined;

/**
 * The format a file of this name opens as: `.txt` is text, `.md` is Markdown, `.recipe` a recipe,
 * and anything else
 * a brief — which is what every file the window opened was before TYTO-247, `brief.brief` of a
 * queue task and a save-as with no extension included.
 */
export const documentFormatOf = (name: string): DocumentFormat => textFormatOf(name) ?? 'brief';
