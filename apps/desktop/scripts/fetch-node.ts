import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Puts the Node that runs installed plugins at `out/node/` (TYTO-186, ADR 0050).
 *
 * The version and each archive's sha256 are `bundled-node.json`'s, the one place they are
 * written. The archive is Node's official build from nodejs.org, checked against that sha256
 * before anything is extracted, and kept in `~/.cache/tyto/node/` so a second build does not
 * download it again. Only the binary and its `LICENSE` are kept.
 *
 * `out/node/` rather than `build/`, because Turbo caches `out/**` for this package: a cache hit
 * that restored the bundles and not the Node beside them would be a desktop whose plugins
 * cannot start.
 *
 * Run by `pnpm build`, for the platform it runs on. Every packaging runs on the platform it
 * packages (`desktop.yml`'s matrix and `test:package`), so that is the platform whose Node the
 * package needs.
 *
 * **On macOS that Node is universal: both official archives, joined with `lipo`** (TYTO-146).
 * The macOS package is one universal `dmg`, which electron-builder makes by packing an x64 and
 * an arm64 app and handing both to `@electron/universal`. That refuses a Mach-O file that is
 * byte-identical in the two and not already universal (`Detected file … that's the same in
 * both x64 and arm64 builds`), and an `out/node/node` built for one architecture is exactly
 * that. A file that is already universal on both sides it keeps as it is ("is already
 * universal across builds, skipping lipo"), so joining the two here is what lets the merge
 * through and what gives the Intel slice a Node it can run.
 */

interface Archive {
  readonly file: string;
  readonly sha256: string;
}

interface Pin {
  readonly version: string;
  readonly archives: Readonly<Record<string, Archive>>;
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pin = JSON.parse(readFileSync(join(root, 'bundled-node.json'), 'utf8')) as Pin;

/** The archives this platform's Node is made of: one, or on macOS the two `lipo` joins. */
const sources =
  process.platform === 'darwin'
    ? ['darwin-x64', 'darwin-arm64']
    : [`${process.platform}-${process.arch}`];
const target = process.platform === 'darwin' ? 'darwin-universal' : sources[0]!;

function archiveFor(key: string): Archive {
  const found = pin.archives[key];
  if (found !== undefined) return found;
  throw new Error(
    `bundled-node.json pins no Node archive for ${key}; it has ${Object.keys(pin.archives).join(', ')}`,
  );
}

const out = join(root, 'out', 'node');
const binaryName = process.platform === 'win32' ? 'node.exe' : 'node';
const stamp = join(out, 'VERSION');

function sha256Of(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function archiveBytes(archive: Archive): Promise<Buffer> {
  const cached = join(homedir(), '.cache', 'tyto', 'node', archive.file);
  if (existsSync(cached)) {
    const bytes = readFileSync(cached);
    if (sha256Of(bytes) === archive.sha256) return bytes;
  }
  const url = `https://nodejs.org/dist/v${pin.version}/${archive.file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = sha256Of(bytes);
  if (actual !== archive.sha256) {
    throw new Error(`${url} has sha256 ${actual}; bundled-node.json pins ${archive.sha256}`);
  }
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, bytes);
  return bytes;
}

/** Extracts one pinned archive under `work` and returns the folder its files are in. */
async function extract(key: string, work: string): Promise<string> {
  const archive = archiveFor(key);
  const file = join(work, archive.file);
  writeFileSync(file, await archiveBytes(archive));
  // Windows' own bsdtar reads a zip; the GNU tar Git Bash puts first on PATH does not.
  const tar =
    process.platform === 'win32'
      ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  execFileSync(tar, ['-xf', file, '-C', work], { stdio: 'inherit' });
  return join(work, archive.file.replace(/\.(zip|tar\.gz|tar\.xz)$/u, ''));
}

if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === `${pin.version} ${target}`) {
  process.stdout.write(`bundled Node ${pin.version} for ${target} is already in out/node\n`);
} else {
  const work = mkdtempSync(join(tmpdir(), 'tyto-node-'));
  try {
    const folders: string[] = [];
    for (const key of sources) folders.push(await extract(key, work));
    const binaries = folders.map((folder) =>
      process.platform === 'win32' ? join(folder, binaryName) : join(folder, 'bin', binaryName),
    );

    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    if (binaries.length === 1) copyFileSync(binaries[0]!, join(out, binaryName));
    else execFileSync('lipo', ['-create', ...binaries, '-output', join(out, binaryName)]);
    // Both macOS archives carry the same LICENSE; the first one's is kept.
    copyFileSync(join(folders[0]!, 'LICENSE'), join(out, 'LICENSE'));
    writeFileSync(stamp, `${pin.version} ${target}\n`);
    process.stdout.write(`bundled Node ${pin.version} for ${target} into out/node\n`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
