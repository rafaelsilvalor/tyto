/**
 * Fixtures are imported as text with Vite's `?raw`, the way `brief-lang`, `template-lang`
 * and `pipeline` already do it. Here they are written back out to a temp folder, because
 * the thing under test is a folder on a real disk.
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
