import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node by default: jsdom costs seconds per file, and half the suite only builds an
    // `EditorState` or walks a Lezer tree. A file that mounts an `EditorView` opts in with a
    // `// @vitest-environment jsdom` first line, the convention `apps/desktop` uses (TYTO-236).
    // `src/test-setup.ts` fills the one hole jsdom leaves that CodeMirror reaches into.
    setupFiles: ['./src/test-setup.ts'],
  },
});
