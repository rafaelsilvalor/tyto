import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { BUILT_IN_FORMATS_FILE, BUILT_IN_PACK, GALLERY_IMAGES, readPack } from './pack.ts';

/**
 * The gallery's pictures, one per built-in template (`pnpm docs:template-shots`, ADR 0102).
 *
 * Not a test and not in CI: a picture needs Chromium and the brand fonts, and the Linux runner
 * has neither CircularXX nor any reason to (it draws substitutes). So the pictures are made on
 * a machine that has them, by this one command, and committed through LFS like the window's.
 *
 * It drives the built CLI as a program, the way a person would, rather than importing the
 * raster adapter: composing adapters is `apps/*`'s job (architecture.md), and the binary is
 * the composition. Build it first: `pnpm --filter @tyto/cli... build`.
 *
 * **Any diagnostic stops it.** A `W_FONT_SUBSTITUTED` is the one that matters: on a machine
 * without the brand fonts the render succeeds, in the wrong typeface, and a picture that looks
 * almost right would be published as the template. A warning is a wrong picture here.
 *
 * **No brand kit reaches it.** A brand's logo and signature come from a kit installed on the
 * machine (ADR 0063) and stay out of the public repository (E15), so every render runs with a
 * `TYTO_HOME` of its own, created empty, and the templates draw their stand-ins (ADR 0065).
 * Before any render the same environment is asked which plugins it has, and one that
 * contributes a `brand-kit` stops the run: the isolation is checked, not assumed.
 */

const CLI = fileURLToPath(new URL('../../../../apps/cli/dist/index.js', import.meta.url));
const run = promisify(execFile);

interface Result {
  readonly status: 'ok' | 'error';
  readonly artifacts: readonly { readonly name: string; readonly format: string }[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

// The renders' environment: this machine's, with a plugin home nobody installed anything in.
const home = await mkdtemp(join(tmpdir(), 'tyto-shots-home-'));
const environment = { ...process.env, TYTO_HOME: home };

interface PluginList {
  readonly plugins: readonly { readonly name: string; readonly contributes: readonly string[] }[];
}

const listed = await run(process.execPath, [CLI, 'plugin', 'list', '--json'], {
  env: environment,
});
const kits = (JSON.parse(listed.stdout) as PluginList).plugins.filter((plugin) =>
  plugin.contributes.includes('brand-kit'),
);
if (kits.length > 0) {
  await rm(home, { recursive: true, force: true });
  throw new Error(
    `a brand kit is reachable from ${environment.TYTO_HOME}: ${kits.map((kit) => kit.name).join(', ')}. ` +
      'The gallery shows the templates without any brand (ADR 0102).',
  );
}

const pack = await readPack();
if (pack.failures.length > 0)
  throw new Error(`the pack did not load:\n${pack.failures.join('\n')}`);

await mkdir(GALLERY_IMAGES, { recursive: true });
const problems: string[] = [];

for (const { manifest, example, pictureFormat } of pack.templates) {
  const out = await mkdtemp(join(tmpdir(), `tyto-shot-${manifest.name}-`));
  try {
    // A failed render exits non-zero and still writes result.json, which says why; the exit
    // code is read from the document instead of thrown away with the error.
    await run(
      process.execPath,
      [
        CLI,
        'render',
        join(BUILT_IN_PACK, manifest.name, example),
        '--out',
        out,
        '--templates',
        BUILT_IN_PACK,
        '--formats-file',
        BUILT_IN_FORMATS_FILE,
        '--formats',
        pictureFormat,
        '--types',
        'png',
      ],
      { env: environment },
    ).catch(() => undefined);

    const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8')) as Result;
    const first = result.artifacts.find((artifact) => artifact.format === pictureFormat);
    if (result.status !== 'ok' || result.diagnostics.length > 0 || first === undefined) {
      problems.push(
        `${manifest.name} (${example}, ${pictureFormat}): ${result.status}` +
          result.diagnostics.map((item) => `\n  ${item.code} ${item.message}`).join(''),
      );
      continue;
    }

    const target = join(GALLERY_IMAGES, `${manifest.name}.png`);
    await copyFile(join(out, first.name), target);
    console.log(`wrote ${target} from ${example}`);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

await rm(home, { recursive: true, force: true });

if (problems.length > 0) {
  console.error(`\n${String(problems.length)} picture(s) not written:\n${problems.join('\n')}`);
  process.exitCode = 1;
}
