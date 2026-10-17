/**
 * `.brief` fixtures are imported as text with Vite's `?raw`, not read with `node:fs`.
 *
 * This package is pure (ADR 0010): a test that reached for the filesystem would be the
 * first Node import in it, and the lint boundary would stop it. A raw import is resolved
 * by the bundler, so the corpus stays inline and the package stays runtime-agnostic.
 */
declare module '*.brief?raw' {
  const content: string;
  export default content;
}

/**
 * Every fixture as text, through Vite's `import.meta.glob`, for the formatter's guarantee that
 * no fixture changes meaning (`format-brief.test.ts`, TYTO-297).
 */
interface ImportMeta {
  glob(
    pattern: string,
    options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true },
  ): Record<string, string>;
}
