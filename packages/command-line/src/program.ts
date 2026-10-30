import { Command, CommanderError, Option } from 'commander';

import type { CliEnvironment, CommandInvocation } from './environment.js';
import { deliveryNewCommand } from './delivery.js';
import { EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK, type ExitCode } from './exit.js';
import {
  parseFormatList,
  parsePositiveInteger,
  parseQuality,
  parseSection,
  parseTypes,
} from './options.js';
import { pluginCleanCommand, pluginSyncCommand } from './plugin-files.js';
import { pluginNewCommand } from './plugin-new.js';
import { pluginInstallCommand, pluginListCommand, pluginStateCommand } from './plugin.js';
import { renderCommand } from './render.js';
import { templateCheckCommand, templateNewCommand } from './template.js';
import { trustAddCommand, trustListCommand, trustRemoveCommand } from './trust.js';
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
      "the project's formats.yaml; the built-in sizes when the default is not there",
      DEFAULT_FORMATS_FILE,
    )
    .option('-t, --template <name>', "template to use when the brief's frontmatter names none")
    .option(
      '-f, --formats <ids>',
      "comma-separated format ids; narrows the brief's own list when it has one",
      parseFormatList,
    );
}

function withOutputOptions(command: Command): Command {
  return (
    command
      .option(
        '--types <kinds>',
        'comma-separated: png, jpeg, webp, svg, or a kind an installed exporter adds',
        parseTypes,
        ['png'],
      )
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
      .option('--json', 'print a machine-readable document instead of prose', false)
      // On by default (ADR 0120); `TYTO_GOOGLE_FONTS=off` turns it off for every run too.
      .option(
        '--no-google-fonts',
        'never ask Google Fonts for a face this machine lacks (each fetch sends Google the family, weight and style)',
      )
  );
}

/**
 * Whether an option carries a value the user typed, rather than the default declared above.
 *
 * Commander knows; nothing downstream does, because `opts()` flattens both into one string.
 * `--templates` needs the difference: a folder somebody named and does not have is worth an
 * error, and the default `templates/` not existing stopped being one when a project with no
 * folder of its own started rendering from the built-in pack (ADR 0020).
 */
function namedOnTheCommandLine(command: Command, option: string): boolean {
  return command.getOptionValueSource(option) === 'cli';
}

/**
 * The words from `tyto` down to `command`: `['plugin', 'install']`. The root is left out, so
 * the path is the same whatever name the program was given.
 */
function commandPath(command: Command): string[] {
  const path: string[] = [];
  for (let at: Command | null = command; at?.parent != null; at = at.parent) {
    path.unshift(at.name());
  }
  return path;
}

/** What `environment.refuse` is asked about, read off the command commander is about to run. */
function invocationOf(command: Command): CommandInvocation {
  return {
    path: commandPath(command),
    args: command.args,
    options: command.opts(),
  };
}

/**
 * `signal` reaches the two commands that can stop part of the way through (ADR 0159 decision
 * 6): `watch` stops between sweeps, and `render` between frames, a frame in flight finishing.
 * Every other command runs to its end, as it does in a terminal, which has no way to ask.
 */
export function createProgram(
  environment: CliEnvironment,
  captured: Captured,
  signal?: AbortSignal,
): Command {
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
    // Optional since TYTO-278: a brief inside a workspace whose project file declares an
    // `output` folder goes there. Typed, it wins and is not confined (ADR 0111).
    .option(
      '-o, --out <dir>',
      "folder for the artifacts and result.json, or the parent of --folder's (default: the workspace's output folder)",
    )
    // A flag on `render` rather than a command beside it, and the choice is worth one line:
    // `render` carries ten options that this needs every one of, so a sibling command would
    // be a second copy of the whole surface, its help, its docs and its tests. Off by default
    // is what keeps `--out` exactly what `docs/render-contract.md` publishes — Jacurutu never
    // types this (TYTO-121). Artwork only since TYTO-490 (ADR 0157).
    .option(
      '--folder',
      'write only the artwork into <out>/<brief-name>/ — no result.json, brief or assets/',
      false,
    )
    // TYTO-490, ADR 0157 §6. Every folder comes from the delivery the brief is in, so a folder
    // typed beside it would be a second answer to the same question: refused, not ignored.
    .addOption(
      new Option(
        '--delivery',
        "export into the brief's delivery: artwork into its exports folder, result.json and template.txt beside the brief",
      )
        .default(false)
        .conflicts(['out', 'folder']),
    )
    .option(
      '--assets <dir>',
      "what relative asset paths resolve against (default: assets/ beside the brief, else the brief's folder)",
    )
    .option(
      '--trust',
      "trust the brief's workspace folder and its work profile for this run only; never written to trust.json",
      false,
    )
    // Repeatable, one key each, rather than a JSON blob: a shell quotes `jira.site=acme.example`
    // the same everywhere, and a script adds a key without rebuilding an object (ADR 0147).
    .option(
      '--section <plugin.key=value>',
      "set a key of a plugin's project section for this run, over .tyto/project.json; repeatable, value read as JSON or else as text",
      parseSection,
    );

  withOutputOptions(withProjectOptions(render)).action(async (brief: string) => {
    captured.code = await renderCommand(
      brief,
      {
        ...render.opts(),
        templatesNamed: namedOnTheCommandLine(render, 'templates'),
        formatsNamed: namedOnTheCommandLine(render, 'formatsFile'),
        typesNamed: namedOnTheCommandLine(render, 'types'),
      },
      environment,
      signal,
    );
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
    captured.code = await watchCommand(
      folder,
      {
        ...watch.opts(),
        templatesNamed: namedOnTheCommandLine(watch, 'templates'),
        formatsNamed: namedOnTheCommandLine(watch, 'formatsFile'),
      },
      environment,
      signal,
    );
  });

  /* ------------------------------------------------------------------------- template -- */

  const template = program.command('template').description('author and validate templates');

  const check = template
    .command('check')
    .description(
      'validate a template folder: its manifest, then its markup (a code body is named, not run)',
    )
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
      'grid',
    ])
    .action(async (name: string) => {
      captured.code = await templateNewCommand(name, scaffold.opts(), environment);
    });

  /* ------------------------------------------------------------------------- delivery -- */

  const delivery = program
    .command('delivery')
    .description("make the folders a piece of work is kept in (the project's delivery key)");

  const deliveryNew = delivery
    .command('new')
    .description(
      'make <name>/ with assets/ and editaveis/, and its brief in editaveis/<name>.brief; prints the brief',
    )
    .argument('<name>', "the delivery's folder name, usually the ticket key and a title")
    .option('-t, --template <name>', "start the brief from this template's skeleton")
    .option(
      '--trust',
      'trust the workspace folder and its work profile for this run only; never written to trust.json',
      false,
    )
    .action(async (name: string) => {
      captured.code = await deliveryNewCommand(name, deliveryNew.opts(), environment);
    });

  /* --------------------------------------------------------------------------- plugin -- */

  const plugin = program
    .command('plugin')
    .description('install, list and switch off what extends this Tyto (~/.tyto/plugins)');

  const pluginList = plugin
    .command('list')
    .description(
      'list every plugin: name, version, origin, status and what it contributes; then what the plugin files name, at which commit, and their aliases',
    )
    .argument('[folder]', 'a folder inside the workspace whose plugin files count', '.')
    .option('--active', 'only the plugins a render would activate', false)
    .option('--json', 'print a machine-readable document instead of prose', false)
    .action(async (folder: string) => {
      captured.code = await pluginListCommand({ ...pluginList.opts(), folder }, environment);
    });

  const pluginInstall = plugin
    .command('install')
    .description('install a plugin from a folder, a git URL or an npm package name')
    .argument('<source>', 'a folder, a git URL (git+https://…, …/repo.git) or an npm spec')
    .option('-y, --yes', 'approve its permissions without asking', false)
    .action(async (source: string) => {
      captured.code = await pluginInstallCommand(source, pluginInstall.opts(), environment);
    });

  const pluginNew = plugin
    .command('new')
    .description('scaffold a template-pack plugin from docs/plugin-authoring.md')
    .argument('<name>', "the plugin's name, also its folder's and its template's")
    .option('--out <dir>', 'where the plugin folder is created', '.')
    .option('--code', "a code template, built in the plugin's process, instead of markup")
    .action(async (name: string) => {
      captured.code = await pluginNewCommand(name, pluginNew.opts(), environment);
    });

  const pluginSync = plugin
    .command('sync')
    .description(
      "fetch what the plugin files name (~/.tyto/plugin-files and the workspace's .tyto/plugin-files) and write their locks; tyto render does this too, without --update",
    )
    .argument('[folder]', 'a folder inside the workspace whose plugin files count', '.')
    .option(
      '--update',
      'move every ref to where it is now, instead of the commit the lock pins',
      false,
    )
    .option('-y, --yes', "approve the fetched plugins' permissions without asking", false)
    .action(async (folder: string) => {
      captured.code = await pluginSyncCommand(folder, pluginSync.opts(), environment);
    });

  plugin
    .command('clean')
    .description("delete the cached copies of the plugin files' sources that no lock names")
    .argument('[folder]', 'a folder inside the workspace whose lock counts too', '.')
    .action(async (folder: string) => {
      captured.code = await pluginCleanCommand(folder, environment);
    });

  for (const [change, description] of [
    ['remove', 'delete an installed plugin and what was approved for it'],
    ['disable', 'keep a plugin installed and stop activating it'],
    ['enable', 'activate a disabled plugin again'],
  ] as const) {
    plugin
      .command(change)
      .description(description)
      .argument('<name>', "the plugin's name, as tyto plugin list prints it")
      .action(async (name: string) => {
        captured.code = await pluginStateCommand(change, name, environment);
      });
  }

  /* ---------------------------------------------------------------------------- trust -- */

  const trust = program
    .command('trust')
    .description('the workspace folders this person trusts (~/.tyto/trust.json, ADR 0111)');

  trust
    .command('add')
    .description(
      'trust a workspace folder or a shared work profile file for good, after printing what it does restricted',
    )
    .argument('<path>', 'the workspace folder, or the profile file it names')
    .action(async (path: string) => {
      captured.code = await trustAddCommand(path, environment);
    });

  trust
    .command('list')
    .description('print every trusted folder and profile file, with the day it was trusted')
    .action(async () => {
      captured.code = await trustListCommand(environment);
    });

  trust
    .command('remove')
    .description('take back the trust given to a workspace folder or a work profile file')
    .argument('<folder>', 'the workspace folder or profile file, as it was trusted')
    .action(async (folder: string) => {
      captured.code = await trustRemoveCommand(folder, environment);
    });

  // Applied after the tree is built and to every node of it. Commander copies
  // `_exitCallback` to a subcommand when the subcommand is *created*, so an
  // `exitOverride()` on the root alone would leave `tyto render --nope` calling
  // `process.exit` and taking a test process with it.
  exitOverrideDeep(program);

  // Before the action and after the parse, so the refusal reads the options commander
  // understood rather than guessing at words: `--trust` as an option, never as a value.
  const { refuse } = environment;
  if (refuse !== undefined) {
    program.hook('preAction', async (_program, command) => {
      const refusal = await refuse(invocationOf(command));
      if (refusal === undefined) return;
      environment.console.err(`error: ${refusal}
`);
      throw new CommanderError(EXIT_DIAGNOSTICS, 'tyto.refused', refusal);
    });
  }
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
export async function run(
  argv: readonly string[],
  environment: CliEnvironment,
  signal?: AbortSignal,
): Promise<ExitCode> {
  const captured: Captured = { code: EXIT_OK };
  const program = createProgram(environment, captured, signal);

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
