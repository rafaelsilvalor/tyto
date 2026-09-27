/**
 * The template mode's tag, alone in a module so the window can name the element without loading
 * it (TYTO-44).
 *
 * `template-mode.ts` is loaded with `import()` the first time somebody opens the mode, because
 * statically it put 894 KB into the bundle every window evaluates before `load()` registers its
 * quit listener — and a close arriving in that gap is a push nobody hears, which ADR 0031 answers
 * by keeping the app open. Importing the tag from there would pull the whole module back in.
 */
export const TEMPLATE_MODE_TAG = 'tyto-template-mode';
