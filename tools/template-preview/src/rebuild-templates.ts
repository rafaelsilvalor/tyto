import { build } from 'tsup';

/**
 * Rebuilds `@tyto/templates`' JavaScript with the package's own `tsup.config.ts`.
 *
 * Run as a child process with that package as its working folder, because tsup reads its
 * config and resolves its entries against `process.cwd()` and nothing else.
 *
 * Two settings differ from `pnpm build`, and neither reaches the bytes the CLI loads:
 *
 * - `dts: false` — declarations are for the type checker, not for `tyto render`. They are
 *   what makes the package build take ~11 s instead of well under one, and measured on
 *   this commit the `dist/index.js` written with and without them has the same sha256.
 * - `clean: false` — the config's `clean: true` would delete the `index.d.ts` the last full
 *   build wrote, and every package that type-checks against this one would go red for as
 *   long as the preview runs.
 *
 * Prints one JSON line: `{ ok: true }`, or `{ ok: false, errors }` with esbuild's locations.
 */

interface EsbuildMessage {
  readonly text: string;
  readonly location?: { readonly file: string; readonly line: number; readonly column: number };
}

try {
  await build({ dts: false, clean: false, silent: true });
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
} catch (cause) {
  const errors = (cause as { errors?: readonly EsbuildMessage[] }).errors;
  const reported =
    errors !== undefined && errors.length > 0
      ? errors.map((error) => ({
          text: error.text,
          ...(error.location === undefined
            ? {}
            : {
                file: error.location.file,
                line: error.location.line,
                column: error.location.column,
              }),
        }))
      : [{ text: cause instanceof Error ? cause.message : String(cause) }];
  process.stdout.write(`${JSON.stringify({ ok: false, errors: reported })}\n`);
  process.exitCode = 1;
}
