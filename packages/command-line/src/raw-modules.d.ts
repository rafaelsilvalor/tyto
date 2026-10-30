/**
 * Fixtures are imported as text with Vite's `?raw`, the way `brief-lang`, `template-lang`,
 * `pipeline` and `io` already do it. Here they are written back out to a temp folder,
 * because what is under test is a command run against a project on a real disk.
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

declare module '*.svg?raw' {
  const source: string;
  export default source;
}
