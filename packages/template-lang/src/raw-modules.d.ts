/**
 * `.html` fixtures are imported as text with Vite's `?raw`, not read with `node:fs`.
 *
 * This package is pure (ADR 0010): a test that reached for the filesystem would be the
 * first Node import in it, and the lint boundary would stop it. A raw import is resolved
 * by the bundler, so the corpus stays inline and the package stays runtime-agnostic.
 */
declare module '*.html?raw' {
  const content: string;
  export default content;
}
