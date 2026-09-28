/* eslint-disable -- TYTO-186 throwaway measurement script, never merged. */
// TYTO-186 measurement. DO NOT MERGE.
// `node sizes.mjs <baseline release dir> <release dir with Node>`: prints every installer's
// size in both builds and the difference.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const [baseline, withNode] = process.argv.slice(2);
const installers = (dir) =>
  readdirSync(dir).filter(
    (name) => /\.(exe|dmg|AppImage)$/.test(name) && !name.endsWith('.blockmap'),
  );

for (const name of installers(baseline)) {
  const before = statSync(path.join(baseline, name)).size;
  const after = statSync(path.join(withNode, name)).size;
  const delta = after - before;
  console.log(
    `${name}: ${before} -> ${after} bytes, delta ${delta} (${(delta / 1048576).toFixed(1)} MiB, ${((delta / before) * 100).toFixed(1)}%)`,
  );
}
