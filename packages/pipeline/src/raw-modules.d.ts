/**
 * Fixtures are imported as text with Vite's `?raw`.
 *
 * `pipeline` is a Node package and could read them with `node:fs`, unlike `brief-lang` and
 * `template-lang` where the same declaration exists because the lint boundary forbids it.
 * They are imported the same way anyway: a fixture read at module load is a fixture the
 * test cannot forget to await, and the two packages that already do this are the ones a
 * reader will compare against.
 */
declare module '*.brief?raw' {
  const source: string;
  export default source;
}

declare module '*.html?raw' {
  const source: string;
  export default source;
}

declare module '*.yaml?raw' {
  const source: string;
  export default source;
}
