/**
 * The PR description, linted for attribution and nothing else (TYTO-234).
 *
 * `main` takes squash merges whose body is the PR description, so a tool footer or a
 * co-author trailer written there lands on `main` without ever being a branch commit.
 * The description is markdown, though, not a commit body: under the full commit ruleset
 * `footer-max-line-length` refused 3 of 5 real ones (a Dependabot PR and two of ours) for
 * lines that are nobody's mistake. So `commitlint.yml` lints the title with
 * `commitlint.config.js` as before and the title-plus-description with this file, which
 * takes the very same rule object from it — one pattern list, two scopes.
 */
import { attributionPlugin } from './commitlint.config.js';

export default {
  plugins: [attributionPlugin],
  rules: {
    'no-attribution-trailers': [2, 'always'],
  },
};
