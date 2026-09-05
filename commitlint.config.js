/**
 * Conventional Commits plus the Jira key (docs/git-workflow.md):
 *   feat(export-svg): TYTO-042 support <mask>
 *
 * The key is what links a commit back to the card that justified it, so it is required
 * rather than merely conventional. Squash merges use the PR title, which is linted too.
 */
const JIRA_KEY_IN_SUBJECT = /^TYTO-\d+ [a-z0-9]/;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-jira-key': ({ subject }) => [
          typeof subject === 'string' && JIRA_KEY_IN_SUBJECT.test(subject),
          'subject must start with the Jira key followed by a lowercase description, ' +
            'e.g. "feat(core): TYTO-123 add Frame schema"',
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
