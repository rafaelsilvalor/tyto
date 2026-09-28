/* eslint-disable -- TYTO-186 throwaway measurement script, never merged. */
// TYTO-186 measurement. DO NOT MERGE.
// `node fetch-node.mjs <version> <outDir>`: downloads the official Node archive for this
// runner from nodejs.org, checks it against SHASUMS256.txt, and leaves only the binary
// and its LICENSE in <outDir>.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [version, outDir] = process.argv.slice(2);
const platform = { win32: 'win', darwin: 'darwin', linux: 'linux' }[process.platform];
const extension = platform === 'win' ? 'zip' : platform === 'darwin' ? 'tar.gz' : 'tar.xz';
const stem = `node-v${version}-${platform}-${process.arch}`;
const base = `https://nodejs.org/dist/v${version}`;

const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
const expected = sums
  .split('\n')
  .find((line) => line.endsWith(`  ${stem}.${extension}`))
  ?.split(' ')[0];
if (expected === undefined) throw new Error(`${stem}.${extension} is not in SHASUMS256.txt`);

const archive = Buffer.from(await (await fetch(`${base}/${stem}.${extension}`)).arrayBuffer());
const actual = createHash('sha256').update(archive).digest('hex');
console.log(`${stem}.${extension}: ${archive.length} bytes, sha256 ${actual}`);
if (actual !== expected) throw new Error(`sha256 mismatch: SHASUMS256.txt says ${expected}`);

const work = mkdtempSync(path.join(tmpdir(), 'node-'));
const file = path.join(work, `${stem}.${extension}`);
writeFileSync(file, archive);
// bsdtar on the Windows runner reads zip as well as tar.
// Windows' own bsdtar reads zip; the GNU tar Git Bash puts first on PATH does not.
const tar =
  process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';
execFileSync(tar, ['-xf', file, '-C', work], { stdio: 'inherit' });

const binary =
  platform === 'win' ? path.join(work, stem, 'node.exe') : path.join(work, stem, 'bin', 'node');
mkdirSync(outDir, { recursive: true });
const target = path.join(outDir, path.basename(binary));
copyFileSync(binary, target);
copyFileSync(path.join(work, stem, 'LICENSE'), path.join(outDir, 'LICENSE'));
console.log(`bundled binary ${target}: ${statSync(target).size} bytes`);
