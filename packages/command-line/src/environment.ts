import type { PluginProcessLauncher } from '@tyto/plugin-api';

import type { CloseableRasterizer } from './plugins/rasterizer.js';

/**
 * Everything the commands reach for that is not a pure function of their arguments.
 *
 * A command tree that reads `process.stdout` and launches Chromium from inside its handlers
 * is one no test can drive, and one only a terminal can host. So each capability is a value
 * here, and an app fills it in: `apps/cli` with a terminal's (`defaultEnvironment()` there),
 * the tests with a buffer and a fake, and the window with its own (ADR 0159). Which adapter
 * fills a port is the app's choice, never this package's (ADR 0010).
 *
 * Nothing else belongs in here. The filesystem is reached through `@tyto/io`'s adapters,
 * which both apps compose the same way on the same disk.
 */

/** Where a command writes. Two streams, because a pipe should get the output and not the noise. */
export interface CliConsole {
  /** The answer: artifact names, `--json`, scaffolded paths. */
  out(text: string): void;
  /** Diagnostics and progress. */
  err(text: string): void;
}

export interface CliEnvironment {
  readonly console: CliConsole;
  /**
   * `tyto`'s own version, as it reaches `result.json`'s `tyto.version`.
   *
   * A value rather than a call, so a test can pin it: a document asserted against a
   * version that changes every release is a document asserted against nothing.
   */
  readonly version: string;
  /** Relative paths on the command line resolve against this. */
  readonly cwd: string;
  /**
   * Built on demand, and only by a command that has a raster output to produce.
   *
   * A factory rather than a `Rasterizer`, so `tyto render --types svg` never pays for a
   * browser and `tyto template check` never mentions one. It may throw — a machine
   * without `playwright` installed is exactly that — and a throw here is an internal
   * failure (exit 2) rather than a diagnostic about anybody's brief.
   */
  rasterizer(): CliRasterizer;
  /**
   * How an installed plugin's process is started (ADR 0049, ADR 0159).
   *
   * A terminal forks the Node it runs on (`launchPluginProcess`). The window cannot: Electron's
   * `fork` throws while the RunAsNode fuse is off, so it starts the bundled Node instead
   * (ADR 0067). Optional, for a test that installs nothing; absent, a command that has an
   * installed plugin to start fails as an internal failure (exit 2) and names the plugin. The
   * package never picks a launcher on an app's behalf (ADR 0010).
   */
  readonly launch?: PluginProcessLauncher;
  /**
   * `~/.tyto`, where `tyto plugin install` puts plugins and records what it approved.
   *
   * Optional, and absent means **no installed plugins at all**: a test that does not name a
   * folder of its own must never read the real one, and a missing field is the one default
   * that cannot leak somebody's machine into a snapshot.
   */
  readonly home?: string;
  /**
   * Asks a yes-or-no question on the terminal. Absent when nobody is there to answer — a
   * pipe, a CI job — and then `install` needs `--yes` rather than guessing.
   */
  readonly confirm?: (question: string) => Promise<boolean>;
  /**
   * The environment an installed plugin's `host.credentials` reads, as
   * `TYTO_PLUGIN_<NAME>_<KEY>` (ADR 0042).
   *
   * Optional, and absent means **no credentials at all**, for the reason `home` is: a test
   * must never hand a plugin a secret from the machine it runs on.
   */
  readonly variables?: Readonly<Record<string, string | undefined>>;
}

/**
 * A `Rasterizer` that may own a browser.
 *
 * `close` is optional because the port does not have one — a fake in a test holds nothing
 * to release — and a `tyto render` that left Chromium running would be a command that
 * never returns to the shell.
 */
export type CliRasterizer = CloseableRasterizer;
