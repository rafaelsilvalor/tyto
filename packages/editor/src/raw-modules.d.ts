/**
 * `.brief` files are imported as text with Vite's `?raw`, not read with `node:fs`.
 *
 * This package is DOM-only (ADR 0010): the Electron renderer runs with
 * `nodeIntegration: false`, so a demo or a test that reached for the filesystem would be
 * the first Node import in it and the lint boundary would stop it. A raw import is
 * resolved by the bundler, which is the same answer `@tyto/brief-lang` gives.
 */
declare module '*.brief?raw' {
  const content: string;
  export default content;
}

/**
 * A `manifest.yaml` is read the same way, and for the same reason: the demo checks a brief
 * against the built-in templates, and `parseManifest` takes the file's text.
 */
declare module '*.yaml?raw' {
  const content: string;
  export default content;
}
