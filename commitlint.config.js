/**
 * Conventional Commits plus the Jira key (docs/git-workflow.md):
 *   feat(export-svg): TYTO-042 support <mask>
 *
 * The key is what links a commit back to the card that justified it, so it is required
 * rather than merely conventional. Squash merges use the PR title, which is linted too.
 */
const JIRA_KEY_IN_SUBJECT = /^TYTO-\d+ [a-z0-9]/;

/**
 * The one kind of commit that has no card to name, because no person asked for it.
 *
 * Dependabot writes both the commit and the pull request title — `chore(deps): Bump
 * actions/checkout from 4 to 7` — and `lint` is a required status check, so without an
 * exemption every dependency update it opens is unmergeable. That is measured, not
 * predicted: the first five it produced all failed on this rule alone (TYTO-76).
 *
 * The exemption is the **scope**, not the author. A person bumping a dependency by hand is
 * held to the same rule as the robot rather than to a stricter one, the hole is one a
 * reader of this file can see, and it stays lintable offline — a rule keyed on
 * `github.actor` would live in YAML and mean nothing in the pre-commit hook.
 */
const KEYLESS_SCOPES = new Set(['deps', 'deps-dev']);

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-jira-key': ({ type, scope, subject }) => [
          (type === 'chore' && typeof scope === 'string' && KEYLESS_SCOPES.has(scope)) ||
            (typeof subject === 'string' && JIRA_KEY_IN_SUBJECT.test(subject)),
          'subject must start with the Jira key followed by a lowercase description, ' +
            'e.g. "feat(core): TYTO-123 add Frame schema". ' +
            'Only chore(deps) and chore(deps-dev) may omit it.',
        ],
      },
    },
  ],
  rules: {
    // config-conventional reads the leading "TYTO-123" as upper-case and rejects every
    // subject the house style requires, so subject-jira-key owns subject shape instead.
    'subject-case': [0],
    'subject-jira-key': [2, 'always'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 100],
  },
};
