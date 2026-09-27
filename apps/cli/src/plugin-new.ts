import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { PLUGIN_MANIFEST_FILE } from '@tyto/io';
import { PLUGIN_API_VERSION, validatePluginManifest } from '@tyto/plugin-api';
import { TEMPLATE_NAME, scaffoldTemplate } from '@tyto/template-lang';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { PLUGIN_ENTRY } from './plugins/external.js';
import { displayPath } from './render.js';
import { formatDiagnostics } from './report.js';

/**
 * `tyto plugin new <name>` — a template pack that installs and renders on the first try
 * (TYTO-50, `docs/plugin-authoring.md`).
 *
 * **Plain JavaScript, no dependencies, nothing to build.** `dist/index.js` is written as the
 * file the plugin's thread imports, so `tyto plugin install <folder>` works offline straight
 * after this command. A TypeScript source and a bundler are a choice an author can make
 * later, and a scaffold that needed `npm install` before its first install would fail the
 * first try on every machine without a network — the lesson `tyto template new` learned
 * from its missing font.
 *
 * The template inside is `scaffoldTemplate`'s, the same text `tyto template new` writes, so
 * a pack starts from a template `tyto template check` already passes.
 */

/** Where a pack keeps its templates, relative to the plugin folder (ADR 0046). */
const TEMPLATES_DIRECTORY = 'templates';
const FORMATS_FILE = 'formats.yaml';

export interface PluginNewOptions {
  /** The folder the plugin's folder is created in. */
  readonly out: string;
}

/** The scaffold's files, relative to the plugin folder, in the order they are written. */
export function pluginScaffold(name: string): readonly (readonly [string, string])[] {
  const template = scaffoldTemplate(name, ['feed']);
  const manifest = {
    name,
    version: '0.1.0',
    // The plugin API this scaffold was written against, and anything later (ADR 0040).
    engine: `>=${PLUGIN_API_VERSION}`,
    contributes: ['template-pack'],
    permissions: [],
  };
  const packageJson = {
    name: `tyto-plugin-${name}`,
    version: '0.1.0',
    private: true,
    type: 'module',
    files: [PLUGIN_MANIFEST_FILE, 'dist', TEMPLATES_DIRECTORY],
  };

  return [
    [PLUGIN_MANIFEST_FILE, manifestSource(manifest)],
    ['package.json', `${JSON.stringify(packageJson, null, 2)}\n`],
    [PLUGIN_ENTRY, entrySource(name)],
    [
      join(TEMPLATES_DIRECTORY, FORMATS_FILE),
      "# The sizes this pack's templates are drawn at. A project renders with its own\n" +
        '# formats.yaml, so these ids have to be in it: copy the lines it lacks.\n' +
        'feed: { w: 1080, h: 1080 }\n',
    ],
    [join(TEMPLATES_DIRECTORY, name, 'manifest.yaml'), template.manifest],
    [join(TEMPLATES_DIRECTORY, name, 'template.html'), template.markup],
    [join(TEMPLATES_DIRECTORY, name, 'examples', `${name}.brief`), template.example],
  ];
}

/**
 * The manifest as a person would type it: a field per line, short arrays inline. It is the
 * text `docs/plugin-authoring.md` prints, and a test holds the two to each other.
 */
function manifestSource(manifest: Record<string, unknown>): string {
  const fields = Object.entries(manifest).map(
    ([key, value]) =>
      `  ${JSON.stringify(key)}: ${JSON.stringify(value).replaceAll('","', '", "')}`,
  );
  return `{\n${fields.join(',\n')}\n}\n`;
}

function entrySource(name: string): string {
  return `// Scaffolded by \`tyto plugin new\`. docs/plugin-authoring.md is the guide.
//
// \`activate\` runs in the plugin's own thread and must register before it returns: what it
// registers after that is never sent to Tyto. \`directory\` is relative to this plugin's
// installed folder and may not lead out of it (ADR 0046); Tyto reads the manifests in it.
export function activate(host) {
  host.registerTemplatePack({ id: '${name}', templates: [], directory: '${TEMPLATES_DIRECTORY}' });
}
`;
}

export async function pluginNewCommand(
  name: string,
  options: PluginNewOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const { cwd } = environment;
  const files = pluginScaffold(name);

  // Refused before a folder exists, with the schema's own words: a name `install` would
  // refuse is a plugin nothing can ever load, and a folder whose only next step is
  // deleting it is not a scaffold.
  const [, manifestText = ''] = files[0] ?? [];
  const validated = validatePluginManifest(JSON.parse(manifestText) as unknown);
  if (!validated.ok) {
    environment.console.err(formatDiagnostics(validated.error));
    return EXIT_DIAGNOSTICS;
  }
  // The template inside is named after the plugin, and a template name is the brief
  // grammar's identifier: `2d` is a plugin name and not a template one.
  if (!TEMPLATE_NAME.test(name)) {
    environment.console.err(
      `'${name}' is a plugin name but not a template name, and the scaffold's template is ` +
        'named after the plugin. Start it with a letter.\n',
    );
    return EXIT_DIAGNOSTICS;
  }

  const directory = resolve(cwd, options.out, name);
  const written: string[] = [];
  for (const [file, contents] of files) {
    const path = join(directory, file);
    try {
      await mkdir(dirname(path), { recursive: true });
      // `wx` — never overwrite, for `tyto template new`'s reason: running it twice by
      // accident must not cost somebody the plugin they wrote.
      await writeFile(path, contents, { flag: 'wx' });
    } catch (cause) {
      environment.console.err(
        `Could not create '${displayPath(cwd, path)}': ${
          cause instanceof Error ? cause.message : String(cause)
        }\n`,
      );
      return EXIT_DIAGNOSTICS;
    }
    written.push(displayPath(cwd, path));
  }

  for (const path of written) environment.console.out(`${path}\n`);
  environment.console.err(
    `Next: run 'tyto plugin install ${displayPath(cwd, directory)}', then render ` +
      `${displayPath(cwd, join(directory, TEMPLATES_DIRECTORY, name, 'examples', `${name}.brief`))}.\n`,
  );
  return EXIT_OK;
}
