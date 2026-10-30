import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { REBUILD_SCRIPT, TYTO_BINARY } from './paths.ts';
import {
  type BuildError,
  type PreviewDiagnostic,
  type RebuildOutcome,
  type RebuildPackages,
  spawnNode,
  staleDiagnostics,
} from './tyto.ts';

/**
 * A template in its own repository (ADR 0151), previewed the way Tyto loads it: as an
 * installed plugin (TYTO-485).
 *
 * Such a template has no `template.ts` beside its manifest; its code is the plugin's
 * `dist/index.js`. Handing the repository's `templates/` to `tyto render` as `--templates`
 * reads it as a project template with no code, which is the `E_TEMPLATE_READ` this mode exists
 * to avoid. So each run keeps its own `TYTO_HOME`, and a save goes through three steps:
 *
 * 1. **Build** `src/` with the repository's own `tsup.config.ts`, into a staging folder and
 *    never into the repository's committed `dist/`, which is the author's to rebuild and commit.
 * 2. **Stage** the files the package publishes (`files` in its `package.json`) beside that build.
 * 3. **Install** the stage with `tyto plugin install --yes` into the private home — the CLI's
 *    own install, so what renders is what a person who installed the plugin would see.
 *
 * The stage holds no `node_modules/`: installing the repository folder itself copies them, and
 * that took 48 s on `questao-estrategica` where the stage takes 0.6 s.
 */

/** What `target.ts` finds: the repository and the plugin name its manifest declares. */
export interface TemplateRepository {
  readonly folder: string;
  readonly plugin: string;
}

const PLUGIN_MANIFEST = 'tyto-plugin.json';

/** What a package publishes when its `package.json` lists no `files`. */
const DEFAULT_FILES = [PLUGIN_MANIFEST, 'templates'] as const;

/** The repository whose root holds a `tyto-plugin.json`, read; undefined for any other folder. */
export function readTemplateRepository(folder: string): TemplateRepository | undefined {
  const manifest = join(folder, PLUGIN_MANIFEST);
  if (!existsSync(manifest)) return undefined;
  let name: unknown;
  try {
    name = (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name;
  } catch {
    name = undefined;
  }
  return { folder, plugin: typeof name === 'string' && name !== '' ? name : basename(folder) };
}

/** The template folders under a repository's `templates/`: those holding a `manifest.yaml`. */
export function repositoryTemplates(repository: TemplateRepository): string[] {
  const templates = join(repository.folder, 'templates');
  if (!existsSync(templates) || !statSync(templates).isDirectory()) return [];
  return readdirSync(templates)
    .filter((name) => existsSync(join(templates, name, 'manifest.yaml')))
    .sort();
}

/** The working folders of one run, all inside the run's output folder, deleted with it. */
export interface RepositoryScratch {
  /** The private `TYTO_HOME` the plugin is installed into and `tyto render` reads. */
  readonly home: string;
  /** The package as it would be published: the build and the `files` beside it. */
  readonly stage: string;
  /** An empty folder for `--templates`, so no project template shadows the plugin's. */
  readonly noTemplates: string;
}

export function repositoryScratch(outputRoot: string): RepositoryScratch {
  return {
    home: join(outputRoot, 'home'),
    stage: join(outputRoot, 'stage'),
    noTemplates: join(outputRoot, 'no-templates'),
  };
}

/** `TYTO_HOME`, or `~/.tyto`: the CLI's rule (`apps/cli/src/environment.ts`). */
export function personHome(environment: NodeJS.ProcessEnv = process.env): string {
  const named = environment['TYTO_HOME'];
  return named !== undefined && named !== '' ? named : join(homedir(), '.tyto');
}

interface InstalledFile {
  readonly plugins?: Record<string, unknown>;
}

/**
 * Creates the private home, with the person's other installed plugins copied in.
 *
 * **A brand kit is an installed plugin**, and without it the template draws placeholders where
 * `tyto render` on this machine draws the logo. So every plugin of the person's home but the one
 * previewed is copied, folder and approval alike. The plugin files' copies are not
 * (`plugin-files/`): one of the same name, fetched from the published repository, would load
 * over the one being written.
 */
export async function preparePluginHome(
  scratch: RepositoryScratch,
  repository: TemplateRepository,
  from: string = personHome(),
): Promise<void> {
  await mkdir(join(scratch.home, 'plugins'), { recursive: true });
  await mkdir(scratch.noTemplates, { recursive: true });

  let installed: InstalledFile = {};
  try {
    installed = JSON.parse(await readFile(join(from, 'plugins.json'), 'utf8')) as InstalledFile;
  } catch {
    // No home, or no plugin installed in it: the preview starts from an empty one.
  }
  const kept: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(installed.plugins ?? {})) {
    const folder = join(from, 'plugins', name);
    if (name === repository.plugin || !existsSync(folder)) continue;
    await cp(folder, join(scratch.home, 'plugins', name), { recursive: true });
    kept[name] = entry;
  }
  await writeFile(
    join(scratch.home, 'plugins.json'),
    `${JSON.stringify({ ...installed, plugins: kept }, null, 2)}\n`,
  );
}

/** The ports a refresh runs through; a test swaps the two programs for stand-ins. */
export interface RefreshPorts {
  /** `tsup` with the repository's config, into `outDir`; its errors as `rebuild-templates.ts` prints them. */
  readonly build: (folder: string, outDir: string) => Promise<readonly BuildError[] | undefined>;
  /** `tyto plugin install <stage> --yes` into `home`; undefined on success, the output otherwise. */
  readonly install: (stage: string, home: string) => Promise<string | undefined>;
}

export const DEFAULT_REFRESH_PORTS: RefreshPorts = {
  async build(folder, outDir) {
    const exited = await spawnNode(
      ['--experimental-strip-types', REBUILD_SCRIPT, '--out-dir', outDir],
      folder,
    );
    let document: { ok?: boolean; errors?: BuildError[] };
    try {
      document = JSON.parse(exited.stdout.trim().split('\n').at(-1) ?? '') as typeof document;
    } catch {
      document = { ok: false, errors: [{ text: exited.stderr.trim() || '(no output)' }] };
    }
    return document.ok === true ? undefined : (document.errors ?? []);
  },
  async install(stage, home) {
    const exited = await spawnNode(
      [TYTO_BINARY, 'plugin', 'install', stage, '--yes'],
      dirname(stage),
      {
        ...process.env,
        TYTO_HOME: home,
      },
    );
    return exited.code === 0
      ? undefined
      : `${exited.stderr}${exited.stdout}`.trim() || '(no output)';
  },
};

function installFailed(repository: TemplateRepository, output: string): PreviewDiagnostic[] {
  return [
    {
      severity: 'error',
      code: 'PREVIEW_INSTALL_FAILED',
      message: `tyto plugin install did not install ${repository.plugin}, so the picture would be the one before: ${output}`,
    },
  ];
}

/** The `files` a package publishes, but `dist`, which the stage builds itself. */
function publishedFiles(repository: TemplateRepository): string[] {
  let files: unknown;
  try {
    files = (
      JSON.parse(readFileSync(join(repository.folder, 'package.json'), 'utf8')) as {
        files?: unknown;
      }
    ).files;
  } catch {
    files = undefined;
  }
  const listed = Array.isArray(files)
    ? files.filter((file): file is string => typeof file === 'string')
    : [...DEFAULT_FILES];
  return [...new Set([...listed, PLUGIN_MANIFEST, 'package.json'])].filter(
    (file) => file.replace(/[\\/]+$/u, '') !== 'dist',
  );
}

/**
 * Builds (when the code changed), stages and installs the repository; the session's rebuild
 * port for a template repository.
 *
 * Every refresh stages and installs, whatever was saved: a manifest, an example or the
 * formats are files of the package as much as the build is. Only `packages.templates` — code
 * was saved, or the last build failed — runs the build.
 */
export async function refreshRepository(
  repository: TemplateRepository,
  scratch: RepositoryScratch,
  packages: RebuildPackages,
  ports: RefreshPorts = DEFAULT_REFRESH_PORTS,
): Promise<RebuildOutcome> {
  const built = join(scratch.stage, 'dist');
  if (packages.templates || !existsSync(built)) {
    const errors = await ports.build(repository.folder, built);
    if (errors !== undefined) {
      return {
        ok: false,
        diagnostics: staleDiagnostics(
          repository.plugin,
          repository.folder,
          errors.length > 0 ? errors : [{ text: '(no error reported)' }],
        ),
      };
    }
  }

  // Everything but the build is copied again, so a file deleted from the repository leaves.
  for (const entry of existsSync(scratch.stage) ? readdirSync(scratch.stage) : []) {
    if (entry !== 'dist') await rm(join(scratch.stage, entry), { recursive: true, force: true });
  }
  for (const file of publishedFiles(repository)) {
    const source = join(repository.folder, file);
    if (existsSync(source)) await cp(source, join(scratch.stage, file), { recursive: true });
  }

  const failed = await ports.install(scratch.stage, scratch.home);
  return failed === undefined
    ? { ok: true, diagnostics: [] }
    : { ok: false, diagnostics: installFailed(repository, failed) };
}

/**
 * The session's rebuild port for a repository's run: the private home made inside the run's
 * output folder, then one refresh per request. `main.ts` and the tests' harness share it.
 */
export async function repositoryRebuild(
  repository: TemplateRepository,
  outputRoot: string,
  from: string = personHome(),
): Promise<(packages: RebuildPackages) => Promise<RebuildOutcome>> {
  const scratch = repositoryScratch(outputRoot);
  await preparePluginHome(scratch, repository, from);
  return (packages) => refreshRepository(repository, scratch, packages);
}
