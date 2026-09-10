import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // An optional peer dependency is not a dependency, so esbuild would try to bundle it
  // and fail the build on a machine that has not installed it. The adapter imports it
  // dynamically at launch; keeping the specifier intact is what lets that stay optional.
  external: ['playwright'],
});
