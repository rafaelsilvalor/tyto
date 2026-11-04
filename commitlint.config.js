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

/**
 * Lines that credit a tool or a session instead of describing the change (TYTO-234).
 *
 * The repository is public, and a cloud session committed with a co-author trailer and a
 * link to the session that wrote it. `.claude/settings.json` turns attribution off for
 * sessions that read it; this rule is the check that holds when one does not. It is keyed
 * on line starts, so prose that names a trailer mid-sentence stays legal, and on every
 * co-author rather than on one tool's address: the repository has one maintainer and no
 * pairing to credit.
 *
 * `main` takes squash merges whose body is the PR description, so `commitlint.yml` lints
 * the description with this rule too — which is why the PR footer is here at all. The
 * `Co-authored-by` lines GitHub writes into a squash commit for other commit authors
 * (Changesets, Dependabot) are added after this check runs, and are not what it is for.
 */
export const ATTRIBUTION_LINES = [
  /^\s*co-authored-by\s*:/im,
  /^\s*claude-session\s*:/im,
  /^\W*generated with \[?claude code\]?/im,
];

/**
 * The attribution rule on its own, because `commitlint.description.config.js` lints the PR
 * description with it and nothing else. Both configs take these rules, so the patterns
 * cannot drift apart.
 */
export const attributionPlugin = {
  rules: {
    'no-attribution-trailers': ({ raw }) => [
      !ATTRIBUTION_LINES.some((pattern) => pattern.test(raw ?? '')),
      'commit messages and PR descriptions carry no Co-Authored-By or Claude-Session ' +
        'trailer and no "Generated with Claude Code" footer (docs/git-workflow.md).',
    ],
  },
};

/**
 * The footer tokens a body paragraph may start with (TYTO-603). Any other `Word: ` at the
 * start of a paragraph is prose that the conventional-commits parser would file as a footer,
 * moving it out of the body, so `body-no-footer-paragraph` refuses it.
 *
 * - `BREAKING CHANGE` and `BREAKING-CHANGE`: the two spellings Conventional Commits gives a
 *   breaking-change footer, which Changesets and release tooling read.
 * - `Refs`: the reference footer of Conventional Commits, e.g. `Refs: TYTO-12`.
 * - `Signed-off-by`: Dependabot ends every commit it writes with one (13 of its 13 PRs, all it
 *   has opened, measured on 2026-11-03), and `lint` runs on those commits too.
 *
 * `Co-authored-by` is not here: `no-attribution-trailers` refuses it on its own.
 */
export const ALLOWED_FOOTER_TOKENS = new Set([
  'BREAKING CHANGE',
  'BREAKING-CHANGE',
  'Refs',
  'Signed-off-by',
]);

/** A paragraph's first line that a parser reads as `token: value`. */
const FOOTER_SHAPED_LINE = /^(BREAKING CHANGE|[A-Za-z][A-Za-z-]*): /;

/**
 * The first line of every body paragraph whose `Word: ` start is not an allowed footer.
 * Read from `raw` rather than from the parsed `body`, because the parser has already moved
 * such a paragraph out of the body by the time a rule sees it.
 */
export function footerShapedParagraphs(raw) {
  const lines = (raw ?? '').split(/\r?\n/).slice(1);
  const offenders = [];
  let previous = '';
  for (const line of lines) {
    const match = previous.trim() === '' ? FOOTER_SHAPED_LINE.exec(line) : null;
    if (match && !ALLOWED_FOOTER_TOKENS.has(match[1])) offenders.push(line);
    previous = line;
  }
  return offenders;
}

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
        'body-no-footer-paragraph': ({ raw }) => {
          const offenders = footerShapedParagraphs(raw);
          return [
            offenders.length === 0,
            'a body paragraph never starts with "Word: ", which the parser files as a ' +
              `footer; reword it (allowed footers: ${[...ALLOWED_FOOTER_TOKENS].join(', ')}). ` +
              `Found: ${offenders.map((line) => JSON.stringify(line)).join(', ')}`,
          ];
        },
        // Spread into this plugin rather than listed as a second one: commitlint keeps only
        // one unnamed inline plugin, and a second replaced subject-jira-key outright.
        ...attributionPlugin.rules,
      },
    },
  ],
  rules: {
    // config-conventional reads the leading "TYTO-123" as upper-case and rejects every
    // subject the house style requires, so subject-jira-key owns subject shape instead.
    'subject-case': [0],
    'subject-jira-key': [2, 'always'],
    'no-attribution-trailers': [2, 'always'],
    'body-no-footer-paragraph': [2, 'always'],
    // AGENTS.md › Commits: a subject of at most 72 (TYTO-603). `commitlint.yml` lints the PR
    // title with this file too, so a title is held to 72 as well. GitHub appends " (#n)" to
    // the squash commit on `main` after that check, and `main` is never re-linted: of its
    // last 200 subjects 77 exceed 72 with the suffix and 10 without. The rule looks forward
    // and needs no exemption for history.
    'header-max-length': [2, 'always', 72],
    // A warning, not an error: Dependabot's commits are linted by the required `lint` job,
    // and the markdown table it writes put 12 body lines over 100 in one of them (PR #166).
    'body-max-line-length': [1, 'always', 100],
  },
};
