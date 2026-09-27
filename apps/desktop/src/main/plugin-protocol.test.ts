import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  confinedPath,
  contentTypeOf,
  frameNavigationAllowed,
  panelPolicy,
  panelUrl,
} from './plugin-protocol.js';

let scratch: string;
let root: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'tyto-plugin-protocol-'));
  root = join(scratch, 'plugins', 'demo');
  mkdirSync(join(root, 'panel'), { recursive: true });
  writeFileSync(join(root, 'panel', 'index.html'), '<p>oi</p>');
  writeFileSync(join(root, 'panel', 'a b.js'), '');
  mkdirSync(join(scratch, 'secret'));
  writeFileSync(join(scratch, 'secret', 'id_rsa'), 'key');
  writeFileSync(join(scratch, 'plugins', 'demo-sibling.txt'), 'x');
  // A junction, which Windows creates without elevation, pointing out of the plugin's folder.
  symlinkSync(join(scratch, 'secret'), join(root, 'escape'), 'junction');
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('confinedPath', () => {
  it('serves a file inside the plugin’s folder', async () => {
    expect(await confinedPath(root, '/panel/index.html')).toMatch(/panel[\\/]index\.html$/u);
    expect(await confinedPath(root, '/panel/a%20b.js')).toMatch(/a b\.js$/u);
  });

  it.each([
    ['..', '/../secret/id_rsa'],
    ['.. inside', '/panel/../../secret/id_rsa'],
    ['%2e%2e', '/%2e%2e/secret/id_rsa'],
    ['%2E%2E', '/panel/%2E%2E/%2E%2E/secret/id_rsa'],
    ['an encoded slash', '/..%2fsecret%2fid_rsa'],
    ['an encoded backslash', '/..%5csecret%5cid_rsa'],
    ['a drive', '/C:%5cWindows%5cwin.ini'],
    ['an absolute path', '//etc/passwd'],
    ['a dot', '/./panel/index.html'],
    ['a NUL', '/panel/index.html%00.png'],
    ['a malformed escape', '/panel/%E0%A4%A.html'],
    ['a sibling of the folder', '/../demo-sibling.txt'],
    ['the folder itself', '/'],
  ])('refuses %s', async (_name, path) => {
    expect(await confinedPath(root, path)).toBeUndefined();
  });

  it('refuses a link inside the folder that points out of it', async () => {
    expect(await confinedPath(root, '/escape/id_rsa')).toBeUndefined();
  });

  it('refuses a file that is not there', async () => {
    expect(await confinedPath(root, '/panel/missing.html')).toBeUndefined();
  });
});

describe('frameNavigationAllowed', () => {
  it('lets the window load a panel and the preview load its srcdoc', () => {
    expect(frameNavigationAllowed('about:blank', 'tyto-plugin://demo/panel/index.html')).toBe(true);
    expect(frameNavigationAllowed('', 'about:srcdoc')).toBe(true);
  });

  it('keeps a panel inside its own plugin', () => {
    const from = 'tyto-plugin://demo/panel/index.html';
    expect(frameNavigationAllowed(from, 'tyto-plugin://demo/panel/other.html')).toBe(true);
    expect(frameNavigationAllowed(from, 'https://example.com/')).toBe(false);
    expect(frameNavigationAllowed(from, 'file:///C:/Windows/win.ini')).toBe(false);
    expect(frameNavigationAllowed(from, 'tyto-plugin://other/panel.html')).toBe(false);
    expect(frameNavigationAllowed(from, 'javascript:alert(1)')).toBe(false);
  });
});

describe('what a panel page is served with', () => {
  it('names the page by plugin and path, encoded', () => {
    expect(panelUrl('demo', 'panel/a b.html')).toBe('tyto-plugin://demo/panel/a%20b.html');
  });

  it('has no network and loads only its own plugin’s files', () => {
    const policy = panelPolicy('demo');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain('script-src tyto-plugin://demo');
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/u);
  });

  it('types the files a panel ships', () => {
    expect(contentTypeOf('panel/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeOf('x.exe')).toBe('application/octet-stream');
  });
});
