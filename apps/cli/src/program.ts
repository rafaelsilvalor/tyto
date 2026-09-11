import { Command, CommanderError } from 'commander';

import type { CliEnvironment } from './environment.js';
import { EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK, type ExitCode } from './exit.js';
import { parseFormatList, parsePositiveInteger, parseQuality, parseTypes } from './options.js';
import { renderCommand } from './render.js';
import { templateCheckCommand, templateNewCommand } from './template.js';
import { watchCommand } from './watch.js';

/**
 * The `tyto` command tree.
 *
 * Built around an environment rather than around `process`, so the whole CLI is callable
 * from a test with a string buffer for a terminal (`environment.ts`). Every handler
 * returns an {@link ExitCode} instead of exiting, and {@link run} is the only place a
 * number becomes a process's fate.
 */

/** Where a project's templates and formats live when nobody says otherwise. */
export const DEFAULT_TEMPLATES_DIRECTORY = 'templates';
export const DEFAULT_FORMATS_FILE = 'formats.yaml';

interface Captured {
  code: ExitCode;
}

function withProjectOptions(command: Command): Command {
  return command
    .option(
      '--templates <dir>',
      'folder holding one subfolder per template',
      DEFAULT_TEMPLATES_DIRECTORY,
    )
    .option(
      '--formats-file <path>',
      "the project's formats.yaml, the one place a size is written",
      DEFAULT_FORMATS_FILE,
    )
    .option('-t, --template <name>', "template to use when the brief's frontmatter names none")
    .option(
      '-f, --formats <ids>',
      "comma-separated format ids, when the brief's frontmatter lists none",
      parseFormatList,
    );
}

function withOutputOptions(command: Command): Command {
  return command
    .option('--types <kinds>', 'comma-separated: png, jpeg, webp, svg', parseTypes, ['png'])
    .option(
      '--scale <n>',
      'device pixels per CSS pixel; 2 is the retina export',
      parsePositiveInteger('--scale'),
    )
    .option('--quality <n>', 'encoder quality 1-100, for jpeg and webp only', parseQuality)
    .option(
      '--concurrency <n>',
      'frames rastered at once (default 2)',
      parsePositiveInteger('--concurrency'),
    )
    .option('--json', 'print a machine-readable document instead of prose', false);
}

export function createProgram(environment: CliEnvironment, captured: Captured): Command {
  const program = new Command();

  program
    .name('tyto')
    .description(
      'Compile a brief into artwork: brief to Scene IR to PNG, JPEG, WebP and SVG.\n' +
        'Exit codes: 0 ok, 1 error diagnostics or a bad command line, 2 internal failure.',
    )
    .version(environment.version, '-V, --version', "print tyto's version")
    .showHelpAfterError()
    .configureOutput({
      writeOut: (text) => {
        environment.console.out(text);
      },
      writeErr: (text) => {
        environment.console.err(text);
      },
    });

  /* --------------------------------------------------------------------------- render -- */

  const render = program
    .command('render')
    .description('render one brief into an output folder (the ADR 0011 contract)')
    .argument('<brief>', 'path to the .brief file')
    .requiredOption('-o, --out <dir>', 'folder for the artifacts and result.json')
    .option(
      '--assets <dir>',
      "what relative asset paths resolve against (default: assets/ beside the brief, else the brief's folder)",
    );

  withOutputOptions(withProjectOptions(render)).action(async (brief: string) => {
    captured.code = await renderCommand(brief, render.opts(), environment);
  });

  /* ---------------------------------------------------------------------------- watch -- */

  const watch = program
    .command('watch')
    .description('render every task dropped into <folder>/inbox, forever')
    .argument('<folder>', 'workspace holding inbox/, outbox/ and done/')
    .option(
      '--interval <ms>',
      'milliseconds between sweeps of the inbox (default 1000)',
      parsePositiveInteger('--interval'),
    )
    .option('--once', 'handle what is in the inbox now and exit, instead of watching', false);

  withOutputOptions(withProjectOptions(watch)).action(async (folder: string) => {
    captured.code = await watchCommand(folder, watch.opts(), environment);
  });

  /* ------------------------------------------------------------------------- template -- */

  const template = program.command('template').description('author and validate templates');

  const check = template
    .command('check')
    .description('validate a template folder: its manifest, then its markup')
    .argument('<folder>', 'the templates/<name>/ folder to check')
    .option('--json', 'print a machine-readable document instead of prose', false)
    .action(async (folder: string) => {
      captured.code = await templateCheckCommand(folder, check.opts(), environment);
    });

  const scaffold = template
    .command('new')
    .description('scaffold a template folder from docs/template-authoring.md')
    .argument('<name>', 'the template name, also its folder name')
    .option('--out <dir>', 'where the folder is created', DEFAULT_TEMPLATES_DIRECTORY)
    .option('--formats <ids>', 'comma-separated format ids the template renders', parseFormatList, [
      'feed',
    ])
    .action(async (name: string) => {
      captured.code = await templateNewCommand(name, scaffold.opts(), environment);
    });

  // Applied after the tree is built and to every node of it. Commander copies
  // `_exitCallback` to a subcommand when the subcommand is *created*, so an
  // `exitOverride()` on the root alone would leave `tyto render --nope` calling
  // `process.exit` and taking a test process with it.
  exitOverrideDeep(program);
  return program;
}

function exitOverrideDeep(command: Command): void {
  command.exitOverride();
  for (const child of command.commands) exitOverrideDeep(child);
}

/**
 * Parses `argv` and runs the command it names, returning its exit code.
 *
 * The only place a throw becomes exit 2. Everything below this turns what it can into
 * diagnostics; what reaches here is what nobody could — a browser that will not install,
 * an output folder that cannot be written, a `result.json` that does not match its own
 * schema. Jacurutu retries those and does not retry a brief that will not compile, which
 * is the whole reason ADR 0011 fixes two non-zero codes instead of one.
 */
export async function run(argv: readonly string[], environment: CliEnvironment): Promise<ExitCode> {
  const captured: Captured = { code: EXIT_OK };
  const program = createProgram(environment, captured);

  // `tyto` with nothing after it is somebody asking what this is, not an error.
  if (argv.length === 0) {
    environment.console.out(program.helpInformation());
    return EXIT_OK;
  }

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return captured.code;
  } catch (cause) {
    if (cause instanceof CommanderError) {
      // `--help` and `--version` are reported as errors by `exitOverride` and are not.
      if (
        cause.code === 'commander.helpDisplayed' ||
        cause.code === 'commander.help' ||
        cause.code === 'commander.version'
      ) {
        return EXIT_OK;
      }
      // A command line the parser refused. Exit 1 with everything else a caller has to
      // fix before trying again: it is not an internal failure, and retrying it unchanged
      // would fail identically.
      return EXIT_DIAGNOSTICS;
    }

    environment.console.err(
      `tyto: internal failure — ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`,
    );
    return EXIT_INTERNAL;
  }
}
