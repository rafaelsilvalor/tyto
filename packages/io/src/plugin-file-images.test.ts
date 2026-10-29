import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashOf } from './hash.js';
import { pluginFileImages } from './plugin-file-images.js';

/**
 * The images a plugin file's configuration names (TYTO-439, ADR 0151 decision 2): relative to
 * the file's folder, and kept inside the workspace for a project file and inside `TYTO_HOME`
 * for a machine file, after `realpath`.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let root: string;
let workspace: string;
let home: string;
let projectFiles: string;
let machineFiles: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'tyto-plugin-file-images-'));
  workspace = join(root, 'work');
  home = join(root, 'home', '.tyto');
  projectFiles = join(workspace, '.tyto', 'plugin-files');
  machineFiles = join(home, 'plugin-files');
  await mkdir(join(projectFiles, 'images'), { recursive: true });
  await mkdir(join(machineFiles, 'images'), { recursive: true });
  await writeFile(join(projectFiles, 'images', 'logo.png'), PNG);
  await writeFile(join(machineFiles, 'images', 'logo.png'), PNG);
  await writeFile(join(root, 'outside.png'), PNG);
  await writeFile(join(projectFiles, 'notes.txt'), 'not an image');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('an image a plugin file names', () => {
  it('is read relative to the file’s folder and named from the workspace', async () => {
    const images = pluginFileImages({ home, workspace });

    const image = await images('./images/logo.png', { directory: projectFiles, scope: 'project' });

    expect(image).toMatchObject({
      ref: { id: '.tyto/plugin-files/images/logo.png', source: 'file', hash: hashOf(PNG) },
    });
  });

  it('is named from TYTO_HOME in a machine file, so two files’ logo.png are two images', async () => {
    const images = pluginFileImages({ home, workspace });

    const image = await images('images/logo.png', { directory: machineFiles, scope: 'machine' });

    expect(image).toMatchObject({ ref: { id: 'TYTO_HOME/plugin-files/images/logo.png' } });
  });

  it('may not leave the workspace from a project file', async () => {
    const images = pluginFileImages({ home, workspace });

    const image = await images('../../../outside.png', {
      directory: projectFiles,
      scope: 'project',
    });

    expect(image).toEqual({
      problem: "names '../../../outside.png', which is outside the workspace folder",
    });
  });

  it('may not leave TYTO_HOME from a machine file, nor reach the workspace', async () => {
    const images = pluginFileImages({ home, workspace });

    const image = await images('../../../work/.tyto/plugin-files/images/logo.png', {
      directory: machineFiles,
      scope: 'machine',
    });

    expect(image).toMatchObject({ problem: expect.stringContaining('outside TYTO_HOME') });
  });

  it('says what is wrong with a path that is not there or not an image', async () => {
    const images = pluginFileImages({ home, workspace });
    const from = { directory: projectFiles, scope: 'project' } as const;

    expect(await images('images/none.png', from)).toEqual({
      problem: "names 'images/none.png', which is not there",
    });
    expect(await images('notes.txt', from)).toEqual({
      problem: "names 'notes.txt', which is not an image an export can embed",
    });
  });

  it('has no folder to read a project file’s image from outside a workspace', async () => {
    const images = pluginFileImages({ home });

    expect(await images('images/logo.png', { directory: projectFiles, scope: 'project' })).toEqual({
      problem: 'has no folder it may be read from',
    });
  });
});
