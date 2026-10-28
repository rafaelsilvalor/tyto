/**
 * Example briefs, manifests and the formats catalogue are imported as text with Vite's `?raw`,
 * not read with `node:fs`.
 *
 * This package is pure (ADR 0010): a test that reached for the filesystem would be the first
 * Node import in it, and the lint boundary would stop it. A raw import is resolved by the
 * bundler, so the snapshot test reads the very files the package ships.
 */
declare module '*.brief?raw' {
  const content: string;
  export default content;
}

declare module '*.yaml?raw' {
  const content: string;
  export default content;
}
