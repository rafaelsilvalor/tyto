import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TYTO_BINARY } from './paths.ts';
import { startPreviewServer } from './server.ts';
import { PreviewSession } from './session.ts';
import { DEFAULT_PORT, UsageError, parseArguments, resolveTarget } from './target.ts';
import { watchTarget } from './watch.ts';

/**
 * `pnpm template:preview <template>` — serves what `tyto render` draws for a template,
 * and draws it again on every save. `docs/template-authoring.md` has the how and the why.
 */

async function main(): Promise<void> {
  // `pnpm --filter … start` runs this with the package as its working folder; `INIT_CWD`
  // is where the person typed the command, which is what a relative path means to them.
  const cwd = process.env['INIT_CWD'] ?? process.cwd();

  let target;
  let port: number;
  try {
    const parsed = parseArguments(process.argv.slice(2));
    target = resolveTarget(parsed, cwd);
    port = parsed.port ?? DEFAULT_PORT;
  } catch (cause) {
    if (!(cause instanceof UsageError)) throw cause;
    process.stderr.write(`${cause.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (!existsSync(TYTO_BINARY)) {
    process.stderr.write(
      `${TYTO_BINARY} is not built; run \`pnpm template:preview\`, which builds it first\n`,
    );
    process.exitCode = 1;
    return;
  }

  const outputRoot = await mkdtemp(join(tmpdir(), 'tyto-preview-'));
  const session = new PreviewSession(target, outputRoot);
  const server = await startPreviewServer(session, port);
  const stopWatching = watchTarget(target, session);

  session.onChange((state) => {
    if (state.status !== 'ok' && state.status !== 'failed') return;
    const timing =
      state.changeToPictureMs === undefined ? '' : ` in ${String(state.changeToPictureMs)} ms`;
    process.stdout.write(
      `generation ${String(state.generation)}: ${state.status}, ${String(state.images.length)} image(s), ` +
        `${String(state.diagnostics.length)} diagnostic(s)${timing}\n`,
    );
  });

  process.stdout.write(`${target.template}: ${server.url}  (state: ${server.url}api/state)\n`);
  // The first render rebuilds too, so what is on the page is the source on disk and not
  // whatever `dist/` a previous build left.
  void session.request({ rebuild: true });

  const stop = (): void => {
    stopWatching();
    void server.close().then(() => rm(outputRoot, { recursive: true, force: true }));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

await main();
