import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CliEnvironment } from './environment.js';
import { launchPluginProcess } from './plugins/plugin-process.js';
import { run } from './program.js';

/**
 * An installed plugin's frame cannot make `tyto render` embed a file it was not handed
 * (TYTO-479), against a real temp disk and the real, confined plugin process.
 *
 * Measured before the fix: a `build` that answered an image node whose `AssetRef.path` was
 * an absolute path outside every folder Tyto grants rendered with exit 0, no diagnostic,
 * and the file's bytes in the SVG. The plugin's process cannot read that file; the host's
 * export did, on the frame's behalf.
 */

let workspace: string;
let home: string;
let errors: string[];

function environment(): CliEnvironment {
  return {
    console: { out: () => undefined, err: (text) => errors.push(text) },
    version: '0.0.0-test',
    cwd: workspace,
    home,
    launch: launchPluginProcess,
    rasterizer: () => {
      throw new Error('these renders are svg and never raster');
    },
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'tyto-asset-containment-'));
  home = join(workspace, 'home', '.tyto');
  errors = [];
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** A 1×1 PNG nobody granted, so its base64 in a render can only have come from that file. */
const SECRET_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==',
  'base64',
);

/** A `build` that draws, full-bleed, the file at `absolute` under a path it wrote itself. */
function leakingEntry(name: string, absolute: string): string {
  return `function build(template, context) {
  const { w, h } = context.size;
  return { format: context.format, size: context.size, children: [{
    id: context.idPrefix + '.leak', kind: 'image', size: { w, h },
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
    opacity: 1, blend: 'normal', visible: true, clip: false, effects: [],
    asset: { id: 'leak.png', source: 'file', path: ${JSON.stringify(absolute)}, hash: 'sha256:made-up' },
    fit: 'cover',
  }] };
}
export function activate(host) {
  host.registerTemplatePack({ id: '${name}', templates: [], directory: 'templates', build });
}
`;
}

describe("an installed code template's frame (TYTO-479)", () => {
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('does not embed a file outside every granted folder, and names the plugin', async () => {
    const secret = join(workspace, 'elsewhere', 'private', 'secret.png');
    await mkdir(join(workspace, 'elsewhere', 'private'), { recursive: true });
    await writeFile(secret, SECRET_PNG);

    expect(
      await run(['plugin', 'new', 'vaza', '--code', '--out', 'sources'], environment()),
      errors.join(''),
    ).toBe(0);
    const folder = join(workspace, 'sources', 'vaza');
    await writeFile(join(folder, 'dist', 'index.js'), leakingEntry('vaza', secret));
    expect(await run(['plugin', 'install', folder, '--yes'], environment()), errors.join('')).toBe(
      0,
    );

    // The brief in a folder of its own, so the plugin's folder is not the brief's either.
    const briefFolder = join(workspace, 'brief');
    await mkdir(briefFolder);
    const brief = join(briefFolder, 'vaza.brief');
    await writeFile(
      brief,
      await readFile(join(folder, 'templates', 'vaza', 'examples', 'vaza.brief'), 'utf8'),
    );
    const out = join(workspace, 'out');
    await run(
      [
        'render',
        brief,
        '--out',
        out,
        '--formats-file',
        join(folder, 'templates', 'formats.yaml'),
        '--types',
        'svg',
      ],
      environment(),
    );

    const result = JSON.parse(await readFile(join(out, 'result.json'), 'utf8')) as {
      diagnostics: { code: string; message: string }[];
    };
    const refused = result.diagnostics.filter((item) => item.code === 'E_PLUGIN_TEMPLATE_ASSET');
    expect(refused).toHaveLength(1);
    expect(refused[0]?.message).toContain("Plugin 'vaza'");
    expect(refused[0]?.message).toContain("'leak.png'");
    // The frame was refused, so nothing drew it; and nothing the run wrote holds the bytes.
    const written = await readFile(join(out, 'result.json'), 'utf8');
    const svg = await readFile(join(out, 'grid-01.svg'), 'utf8').catch(() => '');
    expect(written + svg).not.toContain(SECRET_PNG.toString('base64'));
  }, 60_000);
});
