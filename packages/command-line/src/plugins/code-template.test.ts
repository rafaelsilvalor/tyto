import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  type Diagnostic,
  type ResolvedBrief,
  type Scene,
  compileDeferred,
  createFaceCache,
  describeFace,
  formatCatalogue,
  isDeferredTemplate,
  loadTemplateRegistry,
} from '@tyto/core';
import { bundledFontOutlinePath, createFontLibrary } from '@tyto/fonts';
import {
  type InstalledTemplateFonts,
  installedPacks,
  installedTemplateSource,
  nodeFileSystem,
} from '@tyto/io';
import { connectIsolatedPlugin, createPluginHost } from '@tyto/plugin-api';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';

import { pluginProcessLauncher } from './plugin-process.js';

/**
 * An installed code template in a real, confined child process (TYTO-189, ADR 0048, ADR
 * 0049): what reaches a render when the template answers, when it does not, and what the
 * runtime refuses it.
 *
 * Each case is a plugin whose `build` body is the case, behind the same checks the CLI
 * composes — `installedPacks`, then `installedTemplateSource`, then `compileDeferred` —
 * with a deadline of one second instead of thirty, so a template stuck in `while (true)`
 * costs this suite one second.
 */

let folder: string;
const closing: (() => Promise<void>)[] = [];

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'tyto-code-template-'));
});

afterEach(async () => {
  for (const close of closing.splice(0)) await close();
  await rm(folder, { recursive: true, force: true });
});

const FORMATS = formatCatalogue({ feed: { w: 100, h: 100 }, story: { w: 100, h: 200 } });

function briefFor(template: string, formats: readonly string[]): ResolvedBrief {
  return {
    template,
    formats,
    slots: {},
    artworks: [],
    assets: [],
    missingRequiredSlots: [],
  };
}

/** A rect as the IR has it, written out: the template's modules import nothing. */
const RECT = `(id, w) => ({
  id, kind: 'rect', size: { w, h: 1 }, radius: [0, 0, 0, 0],
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } },
  opacity: 1, blend: 'normal', visible: true, clip: false, effects: [],
})`;

interface Case {
  readonly body: string;
  readonly permissions?: readonly string[];
  readonly faces?: string;
  readonly formats?: readonly string[];
  readonly fonts?: InstalledTemplateFonts;
}

const bundledFonts = createFontLibrary({ describe: describeFace, directories: [] });
const BUNDLED: InstalledTemplateFonts = {
  outlines: (face) => bundledFonts.source.outlines(face),
  fromMachine: (face) => bundledFonts.fromMachine(face),
};

/** Installs a one-template plugin whose `build` is `body`, and loads the template. */
async function templateOf(options: Case) {
  const plugin = join(folder, 'plugin');
  const template = join(plugin, 'templates', 'cartaz');
  await mkdir(template, { recursive: true });
  const formats = options.formats ?? ['feed'];
  await writeFile(
    join(template, 'manifest.yaml'),
    `name: cartaz\nversion: 1.0.0\nformats: [${formats.join(', ')}]\nslots: {}\n${options.faces ?? ''}`,
  );
  const entry = join(plugin, 'index.js');
  await writeFile(
    entry,
    `const rect = ${RECT};
export function activate(host) {
  host.registerTemplatePack({
    id: 'cartaz', templates: [], directory: 'templates',
    build: (template, context) => { ${options.body} },
  });
}
`,
  );
  const manifest = {
    name: 'cartaz',
    version: '1.0.0',
    engine: '>=0.1',
    contributes: ['template-pack'],
    permissions: [...(options.permissions ?? [])],
  };
  const connected = await connectIsolatedPlugin({
    name: 'cartaz',
    manifest,
    channel: pluginProcessLauncher({ guest: inject('pluginGuest') })({
      name: 'cartaz',
      entry,
      directory: plugin,
    }),
    requireSandbox: true,
    deadlineMs: 1_000,
  });
  if (!connected.ok) throw new Error(connected.error[0]?.message);
  closing.push(() => connected.value.close());

  const packs = await installedPacks(
    createPluginHost(),
    { plugins: [connected.value.plugin], warnings: [], close: async () => undefined },
    () => plugin,
    { allowCode: true },
  );
  expect(packs.warnings).toEqual([]);
  const registry = await loadTemplateRegistry(nodeFileSystem(), [...packs.directories]);
  if (!registry.ok) throw new Error(registry.error[0]?.message);
  const source = installedTemplateSource({
    registry: registry.value,
    packs: packs.code,
    fonts: options.fonts ?? BUNDLED,
    next: { load: () => Promise.reject(new Error('not an installed code template')) },
  });
  const loaded = await source.load('cartaz');
  if (!loaded.ok || !isDeferredTemplate(loaded.value)) throw new Error('not deferred');
  return { template: loaded.value, warnings: loaded.diagnostics, formats };
}

async function compiled(options: Case) {
  const { template, warnings, formats } = await templateOf(options);
  const scene = await compileDeferred(briefFor('cartaz', formats), template, {
    formats: FORMATS,
    faces: createFaceCache(bundledFonts.source),
  });
  return { scene, warnings };
}

function problemsOf(result: { ok: boolean }): readonly Diagnostic[] {
  const value = result as
    { ok: true; diagnostics: Diagnostic[] } | { ok: false; error: Diagnostic[] };
  return value.ok ? value.diagnostics : value.error;
}

function sceneOf(result: { ok: boolean }): Scene {
  if (!result.ok) throw new Error('no scene');
  return (result as unknown as { value: Scene }).value;
}

describe('an installed code template', () => {
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it("is built in the plugin's process, never in Tyto's", async () => {
    const { scene } = await compiled({
      body: "return { format: context.format, size: context.size, children: [rect(context.idPrefix + '.t', process.pid)] };",
    });

    const [node] = sceneOf(scene).artworks[0]?.frames[0]?.children ?? [];
    const pid = node?.kind === 'rect' ? node.size.w : 0;
    expect(pid).toBeGreaterThan(0);
    expect(pid).not.toBe(process.pid);
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it("that reads a file outside its plugin's folder is refused by the runtime (ADR 0049)", async () => {
    const outside = join(folder, 'outside.txt');
    await writeFile(outside, "not the template's");
    const { scene } = await compiled({
      body: `return import('node:fs').then((fs) => { fs.readFileSync(${JSON.stringify(outside)}); return { format: context.format, size: context.size, children: [] }; });`,
    });

    expect(problemsOf(scene).map((problem) => problem.message)).toEqual([
      expect.stringMatching(
        /^Plugin 'cartaz' did not build a frame of template 'cartaz': .*Access to this API has been restricted/u,
      ),
    ]);
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('in while (true) costs one deadline, and the render goes on with a diagnostic', async () => {
    const started = Date.now();
    const { scene } = await compiled({ body: 'while (true) {}' });

    expect(Date.now() - started).toBeLessThan(10_000);
    expect(scene.ok).toBe(true);
    expect(problemsOf(scene).map((item) => [item.code, item.message])).toEqual([
      [
        'E_PLUGIN_TEMPLATE',
        "Plugin 'cartaz' did not build a frame of template 'cartaz': Plugin 'cartaz' did not answer within 1 s, so its process was ended.",
      ],
    ]);
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('that returns a frame the IR refuses gets a diagnostic, not a crash', async () => {
    const { scene } = await compiled({
      body: "return { format: context.format, size: context.size, children: [{ kind: 'blob' }] };",
    });

    const [problem] = problemsOf(scene);
    expect(problem?.code).toBe('E_PLUGIN_TEMPLATE');
    expect(problem?.message).toContain("template 'cartaz'");
    expect(problem?.message).toContain('its answer does not match');
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('that throws costs the frame it threw for, and the other formats are drawn', async () => {
    const { scene } = await compiled({
      formats: ['feed', 'story'],
      body:
        "if (context.format === 'story') throw new Error('no story today');" +
        "return { format: context.format, size: context.size, children: [rect(context.idPrefix + '.t', 1)] };",
    });

    expect(sceneOf(scene).artworks[0]?.frames.map((frame) => frame.format)).toEqual(['feed']);
    expect(problemsOf(scene).map((item) => item.message)).toEqual([
      "Plugin 'cartaz' did not build a frame of template 'cartaz': Plugin 'cartaz' threw while the host was calling it: no story today.",
    ]);
  }, 60_000);
});

/**
 * `font:<family>`, on every machine: a font folder of this test's own, holding a bundled
 * file that the injected `describe` calls CircularXX. Every machine then has a "machine"
 * CircularXX, including CI, which has none of its own.
 */
describe("a face installed on this machine, and a plugin's template", () => {
  const MEASURED =
    "const m = context.measure({ kind: 'text', box: { w: 90 }, align: 'left', valign: 'top', lineHeight: 1.2, letterSpacing: 0, overflow: 'grow'," +
    "  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, anchor: { x: 0, y: 0 } }, opacity: 1, blend: 'normal', visible: true, clip: false, effects: []," +
    "  runs: [{ kind: 'text', text: 'Olá', font: { family: 'CircularXX', source: 'system' }, size: 10, weight: 500, style: 'normal', color: { kind: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } } }] });" +
    "return { format: context.format, size: context.size, children: [rect(context.idPrefix + '.t', m === undefined ? 1 : 2)] };";
  const FACES = 'faces:\n  - { family: CircularXX, weight: 500 }\n';

  async function machineFonts(): Promise<InstalledTemplateFonts> {
    const fonts = join(folder, 'fonts');
    await mkdir(fonts, { recursive: true });
    const bundled = bundledFontOutlinePath({
      family: 'Source Sans 3',
      weight: 400,
      style: 'normal',
    });
    if (bundled === undefined) throw new Error('no bundled Source Sans 3');
    await copyFile(bundled, join(fonts, 'CircularXX-Book.ttf'));
    const library = createFontLibrary({
      describe: () => ({ family: 'CircularXX', weight: 500, style: 'normal' }),
      directories: [fonts],
    });
    return {
      outlines: (face) => library.source.outlines(face),
      fromMachine: (face) => library.fromMachine(face),
    };
  }

  const measuredWidth = (scene: { ok: boolean }): number => {
    const [node] = sceneOf(scene).artworks[0]?.frames[0]?.children ?? [];
    return node?.kind === 'rect' ? node.size.w : 0;
  };

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is withheld without font:<family>, and the load says so', async () => {
    const fonts = await machineFonts();
    expect(fonts.fromMachine({ family: 'CircularXX', weight: 500, style: 'normal' })).toBe(true);

    const { scene, warnings } = await compiled({ body: MEASURED, faces: FACES, fonts });

    expect(warnings.map((item) => item.code)).toEqual(['W_PLUGIN_FONT_WITHHELD']);
    expect(warnings[0]?.message).toContain("'font:CircularXX'");
    expect(measuredWidth(scene)).toBe(1);
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is sent to a plugin that declares font:<family>', async () => {
    const fonts = await machineFonts();

    const { scene, warnings } = await compiled({
      body: MEASURED,
      faces: FACES,
      fonts,
      permissions: ['font:CircularXX'],
    });

    expect(warnings).toEqual([]);
    expect(measuredWidth(scene)).toBe(2);
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('is not sent when the manifest does not declare it, permission or not', async () => {
    const fonts = await machineFonts();

    const { scene } = await compiled({
      body: MEASURED,
      fonts,
      permissions: ['font:CircularXX'],
    });

    expect(measuredWidth(scene)).toBe(1);
  }, 60_000);
});

describe("an installed code template's reports (ADR 0058)", () => {
  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('cross back beside the frame and become the catalog warning', async () => {
    const { scene } = await compiled({
      body: "context.report({ code: 'W_TEMPLATE_OVERFLOW', overflow: 12 }); return { format: context.format, size: context.size, children: [] };",
    });

    expect(scene.ok).toBe(true);
    expect(problemsOf(scene).map((problem) => problem.message)).toEqual([
      "Artwork 'artwork-1' does not fit format 'feed': its content runs 12px past the room the template has, and that part is cut.",
    ]);
  }, 60_000);

  // Starts a plugin's process, which a full `pnpm check` can hold past Vitest's 5 s.
  it('outside the closed list cost the frame, and write no diagnostic of the plugin’s', async () => {
    const { scene } = await compiled({
      body: "context.report({ code: 'E_ASSET_NOT_FOUND', overflow: 12 }); return { format: context.format, size: context.size, children: [] };",
    });

    expect(problemsOf(scene).map((problem) => problem.code)).toEqual(['E_PLUGIN_TEMPLATE']);
  }, 60_000);
});
