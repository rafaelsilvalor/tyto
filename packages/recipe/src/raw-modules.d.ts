/**
 * `.recipe` fixtures are imported as text with Vite's `?raw`, not read with `node:fs`: this
 * package is pure (ADR 0010), and a test that reached for the filesystem would be its first
 * Node import, which the lint boundary stops.
 */
declare module '*.recipe?raw' {
  const content: string;
  export default content;
}
