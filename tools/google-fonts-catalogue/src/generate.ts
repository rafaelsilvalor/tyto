import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type GoogleMetadata,
  type Licence,
  buildCatalogue,
  serialiseCatalogue,
} from './catalogue.ts';

/**
 * `pnpm --filter @tyto/google-fonts-catalogue generate`: reads Google's two public sources and
 * rewrites `packages/google-fonts/src/catalogue.json` (TYTO-281, ADR 0120).
 *
 * Run by a person, on purpose, and committed: the package never reads the catalogue from the
 * network, so a render on an offline machine knows which families are Google's, and a change
 * to the catalogue is a diff somebody reviewed.
 */

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '..', '..', '..', 'packages', 'google-fonts', 'src', 'catalogue.json');
const LICENCES: readonly Licence[] = ['ofl', 'apache', 'ufl'];

interface Tree {
  readonly tree: readonly { readonly path: string; readonly type: string; readonly sha: string }[];
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
  const text = await response.text();
  // The metadata endpoint prefixes its JSON with `)]}'` against script inclusion.
  return JSON.parse(text.slice(text.indexOf('{'))) as T;
}

const root = await json<Tree>('https://api.github.com/repos/google/fonts/git/trees/main');
const licences = new Map<string, Licence>();
for (const licence of LICENCES) {
  const folder = root.tree.find((entry) => entry.path === licence && entry.type === 'tree');
  if (folder === undefined) throw new Error(`google/fonts has no ${licence}/ folder`);
  const listing = await json<Tree>(
    `https://api.github.com/repos/google/fonts/git/trees/${folder.sha}`,
  );
  for (const entry of listing.tree) if (entry.type === 'tree') licences.set(entry.path, licence);
}

const metadata = await json<GoogleMetadata>('https://fonts.google.com/metadata/fonts');
const today = new Date().toISOString().slice(0, 10);
const { catalogue, unlicensed } = buildCatalogue(metadata, licences, today);
await writeFile(target, serialiseCatalogue(catalogue));

process.stdout.write(
  `${String(catalogue.families.length)} families written to ${join('packages', 'google-fonts', 'src', 'catalogue.json')}; ` +
    `${String(unlicensed.length)} left out with no licence folder: ${unlicensed.join(', ')}\n`,
);
