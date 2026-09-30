import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  type DeferredTemplate,
  type Diagnostic,
  type FontFace,
  type TemplateContext,
  type TemplateManifest,
  type TemplateRegistry,
  diagnostic,
  err,
  ok,
} from '@tyto/core';
import { TEMPLATE_FILE, type TemplateSource } from '@tyto/pipeline';
import type { IsolatedPackBuild, ShippedFace } from '@tyto/plugin-api';

import type { InstalledCodePack } from './installed-packs.js';

/**
 * Installed code templates, built in their plugin's process (TYTO-189, ADR 0048).
 *
 * A name the registry found in a pack that registered `build`, in a folder with no
 * `template.html`, loads as a `DeferredTemplate` whose every frame is one call to the
 * plugin. **There is no other way to load one**: nothing here imports a module, so the
 * code a plugin ships runs in its process and under ADR 0042's deadline or not at all.
 * Every other name falls through to `next`, with its wording intact.
 *
 * The call carries the faces the manifest declares (`faces:`), because the template
 * measures synchronously on the far side (ADR 0038) and cannot ask for one mid-build. Each
 * face crosses once per plugin process. A face this machine has installed crosses only to a
 * plugin whose manifest declares `font:<family>`, which the person approved at install:
 * such a file can be a licence the person holds and the plugin's author does not, and the
 * file is handed to the plugin's process by the host, so the process's confinement to its
 * own folder does not stop it (ADR 0049). One it may not have measures as
 * `undefined` there, and the load says so with `W_PLUGIN_FONT_WITHHELD`.
 */

/** Where the bytes of a face come from, and whether they are this machine's. */
export interface InstalledTemplateFonts {
  outlines(face: FontFace): Uint8Array | undefined;
  fromMachine(face: FontFace): boolean;
}

export interface InstalledTemplateSourceOptions {
  readonly registry: TemplateRegistry;
  readonly packs: readonly InstalledCodePack[];
  readonly fonts: InstalledTemplateFonts;
  readonly next: TemplateSource;
}

/**
 * The faces already sent to a plugin's process, by the proxy that reaches it. One proxy is
 * one process for its whole life, and a `WeakMap` forgets both together.
 */
const sentTo = new WeakMap<IsolatedPackBuild, Set<string>>();

function keyOf(face: FontFace): string {
  return `${face.family}|${String(face.weight)}|${face.style}`;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

export function installedTemplateSource(options: InstalledTemplateSourceOptions): TemplateSource {
  const { registry, packs, fonts, next } = options;

  return {
    async load(name) {
      const directory = registry.directoryOf(name);
      const manifest = registry.get(name);
      if (directory === undefined || manifest === undefined) return next.load(name);
      const pack = packs.find((candidate) => candidate.directory === dirname(directory));
      // A markup template in a code pack is still markup: the pack's `build` draws the
      // folders that have nothing else to draw them.
      if (pack === undefined || (await exists(join(directory, TEMPLATE_FILE)))) {
        return next.load(name);
      }

      const { faces, warnings } = facesFor(pack, manifest, fonts);
      return ok(deferred(pack, manifest, faces, fonts), warnings);
    },
  };
}

/** The declared faces this plugin may be sent, and a warning for each it may not. */
function facesFor(
  pack: InstalledCodePack,
  manifest: TemplateManifest,
  fonts: InstalledTemplateFonts,
): { faces: readonly FontFace[]; warnings: readonly Diagnostic[] } {
  const faces: FontFace[] = [];
  const warnings: Diagnostic[] = [];
  const withheld = new Set<string>();
  for (const face of manifest.faces ?? []) {
    if (fonts.fromMachine(face) && !pack.permissions.includes(`font:${face.family}`)) {
      // Once per family: the permission is per family, and so is what the person reads.
      if (!withheld.has(face.family)) {
        withheld.add(face.family);
        warnings.push(
          diagnostic('W_PLUGIN_FONT_WITHHELD', {
            plugin: pack.plugin,
            template: manifest.name,
            family: face.family,
          }),
        );
      }
      continue;
    }
    faces.push(face);
  }
  return { faces, warnings };
}

function deferred(
  pack: InstalledCodePack,
  manifest: TemplateManifest,
  allowed: readonly FontFace[],
  fonts: InstalledTemplateFonts,
): DeferredTemplate {
  return {
    manifest,
    async buildLater(context: TemplateContext) {
      const sent = sentTo.get(pack.build) ?? new Set<string>();
      sentTo.set(pack.build, sent);
      const shipped: ShippedFace[] = [];
      for (const face of allowed) {
        const key = keyOf(face);
        if (sent.has(key)) continue;
        // A face nothing supplies is not measured on the host's side either, so the
        // template is told `undefined` for it and the layout agrees.
        const bytes = fonts.outlines(face);
        if (bytes === undefined) continue;
        shipped.push({ face, bytes });
        sent.add(key);
      }

      // Everything but the functions, which are rebuilt in the plugin.
      const { measure: _measure, report, ...call } = context;
      const answer = await pack.build(manifest.name, call, shipped);
      if (answer.ok) {
        // The reports crossed as data the wire checked against the closed list; the
        // diagnostic, its range and its wording are written here, by `compile` (ADR 0058).
        for (const reported of answer.value.reports) report(reported);
        return ok(answer.value.frame, answer.diagnostics);
      }
      return err([
        diagnostic('E_PLUGIN_TEMPLATE', {
          plugin: pack.plugin,
          template: manifest.name,
          problem: answer.error.map((problem) => problem.message).join(' '),
        }),
      ]);
    },
  };
}
