import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { type FileSystem, loadTemplateRegistry } from '@tyto/core';
import { type InProcessHost, type Plugin, createPluginHost } from '@tyto/plugin-api';
import { BUILT_IN_TEMPLATES_DIRECTORY } from '@tyto/templates';

import manifest from './built-in-templates.tyto-plugin.json';

/**
 * The desktop app's composition root for plugins (ADR 0007, ADR 0010).
 *
 * *Every built-in registered through the same door a third party will use.* The desktop
 * gets its own root rather than sharing the CLI's, because composition is what an app is —
 * `apps/*` is the only layer allowed to know both a port and its adapter, and two apps make
 * different choices about which adapters exist. What they must not do is disagree about
 * *what a built-in is*, which is why both go through `createPluginHost`.
 *
 * **This is the second copy of the template pack plugin**, the first being
 * `apps/cli/src/plugins/templates.ts`. Two is the point at which duplication is cheaper
 * than the package it would take to share it — the shared part is a manifest and four lines
 * of resolver, and a `@tyto/built-ins` package to hold them would be a new runtime boundary
 * to argue about. A third copy is not: whoever writes it should extract these instead.
 */

/**
 * Where `@tyto/templates` put its folder, on this machine, right now.
 *
 * Resolved from the package's own `package.json` rather than guessed from a `node_modules`
 * path, which is the one form that is right in a pnpm workspace (through the symlink), in a
 * published install, and inside an Electron `asar` — where Electron patches both the
 * resolver and `fs`, and a hand-built path is not patched at all. That last case is this
 * app's, which is why the resolver runs here and not in the pure package that owns the
 * folder's name.
 */
export function builtInTemplatesDirectory(): string {
  const packageJson = createRequire(import.meta.url).resolve('@tyto/templates/package.json');
  return join(dirname(packageJson), BUILT_IN_TEMPLATES_DIRECTORY);
}

export interface BuiltInsOptions {
  /** How the pack's manifests are read. The Node adapter, in the app; a fake, in a test. */
  readonly fileSystem: FileSystem;
  /** Overrides the resolved folder, for a test with a pack of its own. */
  readonly directory?: string;
}

/**
 * Activates every built-in this app ships, and hands back the host holding them.
 *
 * One pack today. The exporters and the rasterizer are deliberately absent: the CLI binds
 * an exporter to the bytes of the folder it is rendering, and the desktop has not rendered
 * anything yet — an exporter registered now would be bound to nothing, which is a worse
 * answer than not being registered. They arrive with the card that renders (E9.3), and the
 * desktop rasterizer with E5.4 — a debugger-captured window since ADR 0027, not an offscreen one.
 */
export async function activateBuiltIns(options: BuiltInsOptions): Promise<InProcessHost> {
  const host = createPluginHost();
  const directory = options.directory ?? builtInTemplatesDirectory();

  // Read here rather than inside the plugin: reading manifests is the registry's job, and
  // a pack that read them itself would be a second answer to one question. A pack whose
  // folder cannot be read still registers, with nothing in it — the desktop should open and
  // say it has no templates rather than refuse to open.
  const pack = await loadTemplateRegistry(options.fileSystem, directory);

  const templatePack: Plugin = {
    id: manifest.name,
    manifest,
    activate: (host) =>
      host.registerTemplatePack({
        id: manifest.name,
        templates: pack.ok ? pack.value.list() : [],
        directory,
      }),
  };

  // `host.activate`, not `plugin.activate(host.hostFor(...))`: the host is what validates
  // the `tyto-plugin.json`, checks that `contributes` matches what was actually registered,
  // and records the plugin so a plugins panel has something to list. Calling `hostFor`
  // straight would skip all three — a shortcut available to a built-in and to nobody else,
  // which is the shape ADR 0007 rules out.
  host.activate(templatePack);

  return host;
}
