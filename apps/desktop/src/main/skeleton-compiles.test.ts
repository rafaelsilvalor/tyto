import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { nodeFileSystem } from '@tyto/io';
import { briefSkeleton, skeletonText } from '@tyto/editor';
import { beforeAll, describe, expect, it } from 'vitest';

import { type PreviewService, createPreviewService } from './preview.js';
import { type ProjectSources, createProjectSources } from './project.js';

/**
 * Every built-in template's skeleton compiles as it is inserted (TYTO-275).
 *
 * The card's criterion is that a brief opened from "New brief from template…" compiles with
 * only its placeholders filled, and the strictest form of that is with the placeholders left
 * exactly as they are. Against the pack the app ships and through the preview service the
 * window uses, for the reason `preview.test.ts` gives: what can be wrong is which slots the
 * skeleton picked, and that is only wrong against the real manifests.
 */

const require_ = createRequire(import.meta.url);
const packDirectory = join(dirname(require_.resolve('@tyto/templates/package.json')), 'templates');

/** The pack's template folders, read when the file is collected so each one is its own case. */
const builtInNames = readdirSync(packDirectory, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(join(packDirectory, entry.name, 'manifest.yaml')),
  )
  .map((entry) => entry.name);

let sources: ProjectSources;
let preview: PreviewService;

beforeAll(async () => {
  sources = await createProjectSources({ fileSystem: nodeFileSystem(), builtIn: packDirectory });
  preview = await createPreviewService({ fileSystem: nodeFileSystem(), sources });
});

describe('a built-in template’s skeleton', () => {
  it('is checked for all nine built-in templates', () => {
    // A count, so a folder that stopped being found reads as a failure rather than as fewer
    // green cases.
    expect(builtInNames).toHaveLength(9);
  });

  it.each(builtInNames)('compiles with its placeholders as they are: %s', async (name) => {
    const manifest = sources.current().registry?.get(name);
    expect(manifest).toBeDefined();

    const brief = skeletonText(briefSkeleton(manifest!));
    const result = await preview.preview(brief);

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.frames.length).toBeGreaterThan(0);
  });
});
