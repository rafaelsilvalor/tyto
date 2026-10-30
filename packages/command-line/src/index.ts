/**
 * @tyto/command-line — the `tyto` command tree (commander), for every app that runs it.
 *
 * Moved out of `apps/cli` so the window can run the same commands in its main process without
 * one app importing the other (ADR 0159). Each app builds a {@link CliEnvironment} and calls
 * {@link run}: `apps/cli` with a terminal's adapters, `apps/desktop` with the window's. This
 * package may use Node, as `@tyto/io` does, and chooses no adapter on an app's behalf.
 */

export { type CommandDescription, commandTree } from './commands.js';
export type {
  CliConsole,
  CliEnvironment,
  CliRasterizer,
  CommandInvocation,
} from './environment.js';
export { EXIT_CODES, EXIT_DIAGNOSTICS, EXIT_INTERNAL, EXIT_OK, type ExitCode } from './exit.js';
export { type CloseableRasterizer } from './plugins/rasterizer.js';
export { type PluginSourceKind, pluginSourceKind } from './plugins/fetch.js';
export {
  TEST_GUEST_VARIABLE,
  launchPluginProcess,
  pluginProcessLauncher,
} from './plugins/plugin-process.js';
export {
  DEFAULT_FORMATS_FILE,
  DEFAULT_TEMPLATES_DIRECTORY,
  createProgram,
  run,
} from './program.js';
