import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import { type Diagnostic, parseManifest } from '@tyto/core';
import { fileTemplateAssets } from '@tyto/io';
import { compileTemplate } from '@tyto/template-lang';
import { TEMPLATE_FILE } from '@tyto/pipeline';

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
 */

const MANIFEST_FILE = 'manifest.yaml';

export interface TemplateCheckOptions {
  readonly json: boolean;
}

export async function templateCheckCommand(
  folder: string,
  options: TemplateCheckOptions,
  environment: CliEnvironment,
): Promise<ExitCode> {
  const { cwd } = environment;
  const directory = resolve(cwd, folder);
  const manifestPath = displayPath(cwd, join(directory, MANIFEST_FILE));
  const templatePath = displayPath(cwd, join(directory, TEMPLATE_FILE));

  const problems: Diagnostic[] = [];
  const report = (): ExitCode => {
    if (options.json) {
      environment.console.out(json(diagnosticsDocument(problems)));
    } else if (problems.length === 0) {
      environment.console.err(`${displayPath(cwd, directory)}: no problems found\n`);
    } else {
      environment.console.err(formatDiagnostics(problems));
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
  registerOrigin(manifest.warnings, { path: manifestPath, source: manifestSource });
  problems.push(...manifest.warnings);

  let templateSource: string;
  try {
    templateSource = await readFile(join(directory, TEMPLATE_FILE), 'utf8');
  } catch (cause) {
    // Only the markup path is checked: a `template.ts` is code, and running code that
    // arrived from a folder is the plugin host's job with its permissions (ADR 0007).
    problems.push(...readFailure(templatePath, cause));
    return report();
  }

  // The template's own folder, read the same way `tyto render` reads it. Checking without
  // it would report `E_TEMPLATE_MARKUP` for every `src=` that is perfectly fine — and an
  // author whose first `check` cries wolf learns not to run the second one. A `src` whose
  // file really is missing is still named, which is the half worth keeping.
  const { assets } = await fileTemplateAssets({ base: directory });
  const compiled = compileTemplate(templateSource, { manifest: manifest.value, assets });
  const produced = compiled.ok ? compiled.warnings : compiled.error;
  registerOrigin(produced, { path: templatePath, source: templateSource });
  problems.push(...produced);

  return report();
}

/* ------------------------------------------------------------------------------ new -- */

export interface TemplateNewOptions {
  /** Where the template folder is created. Defaults to the templates root. */
  readonly out: string;
  readonly formats: readonly string[];
}

/**
 * The scaffold, written from `docs/template-authoring.md` and nothing else.
 *
 * Deliberately small and deliberately complete: a manifest with one slot of each kind an
 * author will reach for, and a body that draws them. An author's first edit should be
 * changing something, not adding the first thing.
 */
function manifestFor(name: string, formats: readonly string[]): string {
  return `name: ${name}
version: 0.1.0
description: TODO — one line on what this template is for.
formats: [${formats.join(', ')}]
slots:
  titulo: { type: rich-text, required: true, max: 60 }
  imagem: { type: image }
  cor: { type: enum, values: [azul, laranja], default: azul }
`;
}

function templateFor(formats: readonly string[]): string {
  const [first = 'feed', ...rest] = formats;
  const extended = rest
    .map((format) => `<frame format="${format}" extends="${first}" />\n`)
    .join('');

  return `<!-- Scaffolded by \`tyto template new\`. The vocabulary is in
     docs/template-authoring.md; \`tyto template check\` reports on this file. -->

<frame format="${first}" bg="var(--bg)">
  <image slot="imagem" class="photo" />
  <text slot="titulo" class="title" />
</frame>
${extended}
<style>
  :root {
    --bg: #0c2340;
  }
  /* An enum reaches a value only through @if: --slot-cor holds the word, not the colour. */
  @if slot(cor) is laranja {
    :root {
      --bg: #ff5900;
    }
  }

  .photo {
    x: 0;
    y: 0;
    w: 100%;
    h: 60%;
  }
  .title {
    x: 64;
    y: 70%;
    w: 80%;
    font: 700 72px/1.05 "Inter";
    color: white;
    overflow: shrink;
  }
</style>
`;
}

/** The grammar's identifier, which is what a manifest name and a `--template` flag allow. */
const TEMPLATE_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/u;

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

  // `wx` — never overwrite. A person who ran this twice by accident should not lose the
  // template they spent the afternoon on.
  const written: string[] = [];
  for (const [file, contents] of [
    [MANIFEST_FILE, manifestFor(name, options.formats)],
    [TEMPLATE_FILE, templateFor(options.formats)],
  ] as const) {
    const path = join(directory, file);
    try {
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
