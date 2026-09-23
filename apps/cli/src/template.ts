import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { type Diagnostic, diagnostic, parseManifest } from '@tyto/core';
import { fileTemplateAssets } from '@tyto/io';
import { TEMPLATE_NAME, compileTemplate, scaffoldTemplate } from '@tyto/template-lang';
import { TEMPLATE_FILE, type BundledTemplates } from '@tyto/pipeline';
import { BUILT_IN_TEMPLATE_BUILDS } from '@tyto/templates';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_OK, type ExitCode } from './exit.js';
import { readFailure } from './render-context.js';
import { displayPath } from './render.js';
import { diagnosticsDocument, formatDiagnostics, json, registerOrigin } from './report.js';

/**
 * `tyto template check` and `tyto template new` — step 3 and step 2 of the agent workflow
 * in `docs/template-authoring.md`.
 *
 * `check` is the loop a template author lives in, and the reason it is worth its own
 * command rather than "render something and see": it reads the manifest and the markup and
 * reports on both, without a brief, without a project's `formats.yaml`, and without ever
 * building a scene. A template can be wrong in ways no brief would reveal.
 *
 * ## The two routes, decided the way `tyto render` decides them
 *
 * A folder is checked along the route a render would take it, so `check` and `render`
 * cannot disagree about what a folder is. A manifest name this build ships code for, with
 * no `template.html` beside it, is a **code template**: its manifest is parsed and reported
 * exactly as a markup template's is, and its body is not checked — and the report says so
 * in words, because a clean report that silently skipped half the template reads as a
 * clean template. The body is not run to find out (ADR 0007), and it is not type-checked
 * either: that is the build's job, and `check` would be a second, weaker compiler.
 *
 * **Exit 0 on that route means the manifest is clean**, not that the template is. ADR 0011
 * fixes three exit codes and none of them means "partly checked", so the difference lives
 * in the report, where a person and `--json` both read it. Every other folder takes the
 * markup route, unchanged.
 */

const MANIFEST_FILE = 'manifest.yaml';
const CODE_FILE = 'template.ts';

/** Where a template keeps the briefs it is previewed and checked against. */
const EXAMPLES_DIRECTORY = 'examples';

export interface TemplateCheckOptions {
  readonly json: boolean;
}

/** Something `check` looked at and did not verify, stated rather than implied. */
interface NotChecked {
  readonly subject: string;
  readonly reason: string;
}

export async function templateCheckCommand(
  folder: string,
  options: TemplateCheckOptions,
  environment: CliEnvironment,
  // The CLI's own build: the same table `tyto render` composes in front of markup.
  bundled: BundledTemplates = BUILT_IN_TEMPLATE_BUILDS,
): Promise<ExitCode> {
  const { cwd } = environment;
  const directory = resolve(cwd, folder);
  const manifestPath = displayPath(cwd, join(directory, MANIFEST_FILE));
  const templatePath = displayPath(cwd, join(directory, TEMPLATE_FILE));

  const problems: Diagnostic[] = [];
  const notChecked: NotChecked[] = [];
  const report = (): ExitCode => {
    if (options.json) {
      const document = diagnosticsDocument(problems);
      // Absent rather than empty on the markup route, so its document is what it was.
      environment.console.out(
        json(notChecked.length === 0 ? document : { ...document, notChecked }),
      );
    } else {
      const where = displayPath(cwd, directory);
      if (problems.length > 0) environment.console.err(formatDiagnostics(problems));
      if (notChecked.length > 0) {
        if (problems.length === 0) {
          environment.console.err(`${where}: manifest: no problems found\n`);
        }
        for (const item of notChecked) {
          environment.console.err(`${where}: not checked: ${item.subject} — ${item.reason}\n`);
        }
      } else if (problems.length === 0) {
        environment.console.err(`${where}: no problems found\n`);
      }
    }
    return problems.some((item) => item.severity === 'error') ? EXIT_DIAGNOSTICS : EXIT_OK;
  };

  let manifestSource: string;
  try {
    manifestSource = await readFile(join(directory, MANIFEST_FILE), 'utf8');
  } catch (cause) {
    problems.push(...readFailure(manifestPath, cause));
    return report();
  }

  // The manifest first and alone. A template body is checked *against* a manifest — which
  // slots exist, which formats are rendered — so a manifest that does not parse leaves
  // nothing to check the markup against, and every follow-on complaint would be noise.
  const manifest = parseManifest(manifestSource, manifestPath);
  if (!manifest.ok) {
    registerOrigin(manifest.error, { path: manifestPath, source: manifestSource });
    problems.push(...manifest.error);
    return report();
  }
  registerOrigin(manifest.diagnostics, { path: manifestPath, source: manifestSource });
  problems.push(...manifest.diagnostics);

  const name = manifest.value.name;
  const shipped = bundled[name] !== undefined;

  let templateSource: string;
  try {
    templateSource = await readFile(join(directory, TEMPLATE_FILE), 'utf8');
  } catch (cause) {
    if (shipped) {
      notChecked.push({
        subject: 'the template body',
        reason:
          `'${name}' is code compiled into this build, and check does not run code ` +
          '(ADR 0007). The manifest is what a render checks every brief against.',
      });
      return report();
    }
    problems.push(...(await markupReadFailure(directory, templatePath, name, cause)));
    return report();
  }

  if (shipped) {
    // What `bundledTemplateSource` answers at render time, said before a render has to.
    problems.push(
      diagnostic('E_TEMPLATE_AMBIGUOUS', {
        name,
        file: TEMPLATE_FILE,
        directory: displayPath(cwd, directory),
      }),
    );
    return report();
  }

  // The template's own folder, read the same way `tyto render` reads it. Checking without
  // it would report `E_TEMPLATE_MARKUP` for every `src=` that is perfectly fine — and an
  // author whose first `check` cries wolf learns not to run the second one. A `src` whose
  // file really is missing is still named, which is the half worth keeping.
  const { assets } = await fileTemplateAssets({ base: directory });
  const compiled = compileTemplate(templateSource, { manifest: manifest.value, assets });
  const produced = compiled.ok ? compiled.diagnostics : compiled.error;
  registerOrigin(produced, { path: templatePath, source: templateSource });
  problems.push(...produced);

  return report();
}

/**
 * No `template.html`, and no shipped code under this name.
 *
 * A `template.ts` beside the manifest earns a hint, because the read failure alone reads
 * like a forgotten file when the author wrote the body on purpose — as code, in a folder,
 * where nothing will ever load it (ADR 0007).
 */
async function markupReadFailure(
  directory: string,
  templatePath: string,
  name: string,
  cause: unknown,
): Promise<Diagnostic[]> {
  const failures = readFailure(templatePath, cause);
  const hasCode = await access(join(directory, CODE_FILE)).then(
    () => true,
    () => false,
  );
  if (!hasCode) return [...failures];
  return failures.map((failure) => ({
    ...failure,
    hint:
      `'${CODE_FILE}' is here, but this build ships no code template named '${name}', and ` +
      'code in a folder is never loaded (ADR 0007). A render fails the same way.',
  }));
}

/* ------------------------------------------------------------------------------ new -- */

export interface TemplateNewOptions {
  /** Where the template folder is created. Defaults to the templates root. */
  readonly out: string;
  readonly formats: readonly string[];
}

export async function templateNewCommand(
  name: string,
  options: TemplateNewOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const { cwd } = environment;

  if (!TEMPLATE_NAME.test(name)) {
    // Refused before a folder exists rather than after: a name the manifest schema will
    // reject is a template nothing can ever load, and scaffolding it would leave a folder
    // whose only possible next step is deleting it.
    environment.console.err(
      `'${name}' is not a template name. It has to match ${String(TEMPLATE_NAME.source)} — ` +
        "the grammar's identifier, because the name reaches a shell as --template <name>.\n",
    );
    return EXIT_DIAGNOSTICS;
  }

  const directory = resolve(cwd, options.out, name);
  await mkdir(directory, { recursive: true });

  // The same text the desktop's New template writes (`@tyto/template-lang`, TYTO-44).
  const scaffold = scaffoldTemplate(name, options.formats);

  // `wx` — never overwrite. A person who ran this twice by accident should not lose the
  // template they spent the afternoon on.
  const written: string[] = [];
  for (const [file, contents] of [
    [MANIFEST_FILE, scaffold.manifest],
    [TEMPLATE_FILE, scaffold.markup],
    [join(EXAMPLES_DIRECTORY, `${name}.brief`), scaffold.example],
  ] as const) {
    const path = join(directory, file);
    try {
      await mkdir(dirname(path), { recursive: true });
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
    `Next: edit ${basename(TEMPLATE_FILE)}, then run 'tyto template check ${displayPath(
      cwd,
      directory,
    )}'.\n`,
  );
  return EXIT_OK;
}
