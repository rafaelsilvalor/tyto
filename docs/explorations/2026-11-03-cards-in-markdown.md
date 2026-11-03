# Should the cards leave Jira for Markdown files in a private repository?

Status: **exploration, not binding** · 2026-11-03 · hosted by TYTO-570 · see
`docs/explorations/README.md`

The batches already moved out of the agents' heads into a private repository: one Markdown file
per batch, pulled before every read and pushed after every change. The maintainer asked whether
the cards should follow — every TYTO card as a Markdown file in a private repository, linked to
each other, with Jira retired — and asked for the cost of Jira to be measured before anyone
argued for it.

**Answer: not now.** In the 32 days measured, Jira cost a typical session 3 calls and 9 seconds;
the infrastructure failed on **46 of 2,139 calls** (2.2 %), and 34 of those 46 fell in one
two-day incident. That is a real cost, but it is concentrated in a few heavy sessions and one
bad week, and a migration would trade it for 601 cards and 26 epics to convert, a board and a
query language to rebuild, and a second repository every PR has to keep in step. The cheaper
wins are inside Jira: smaller responses and a Review column that has stopped meaning anything
(122 cards, the 20 oldest all merged). The section _What would change the answer_ says which
numbers would flip this.

## What was measured, and how

**The instrument, before the numbers.** Four things about it bound every figure below.

- **The population is every local transcript, not a sample.** A script read every Claude Code
  transcript file on the maintainer's machine under the Tyto projects, modified since
  2026-10-03: 174 top-level sessions and 277 subagent transcripts. Each tool call was matched
  to its result by id; **346 calls copied into a second file** (forks and resumed sessions
  carry their parent's history) were counted once. Sessions are described by role only.
- **What it leaves out:** Codex threads, cloud sessions, sessions on any other machine,
  transcripts deleted before the run, and everything before 2026-10-03. The two incidents the
  project memory records (20/09 and 22/09) are outside the window and are not in the counts.
  The session's role (coordinator, executor, `/next-card`) is not recoverable from most
  transcript files, so no figure below is split by role.
- **Time is wall time** from the call to its result. It includes any wait for a permission
  prompt, so it is an upper bound on what the server took, most of all for `createJiraIssue`
  and `editJiraIssue`, which are the calls a person is asked to approve.
- **Tokens are a proxy.** The script measured the characters of each result and divides by 4. It does not count tokens, and it ignores that a result stays in the context and is read
  again on every later turn of the session. Read the token figures as an order of magnitude.

Card counts are JQL counts (`searchResultMode: count`) taken on 2026-11-03. The dependency
inventory is a grep of the repository on `origin/main` at `2d8a2599`.

## How many cards there are

| JQL                      | Count |
| ------------------------ | ----: |
| `project = TYTO`         |   601 |
| `statusCategory = Done`  |   293 |
| `status = "To Do"`       |   179 |
| `status = Review`        |   122 |
| `status = Ready`         |     6 |
| `status = "In Progress"` |     1 |
| `issuetype = Epic`       |    26 |
| `created >= -31d`        |   381 |

Two numbers stand out. **381 of the 601 cards were created in the last 31 days**, so card
creation is the activity that grew. And **Review holds 122 cards**: of its 20 oldest (last
touched 21/10 to 24/10), **20 of 20 already have their commits on `main`**. The board's
Review column now means "merged, not yet closed", which is not what `AGENTS.md` says it means.

## What Jira costs a session

**2,139 Jira calls in 32 days, from 166 of the 174 top-level sessions.** Per session that made
any: median **3**, mean 10.3, 90th percentile 31, maximum 92.

| Tool                         | Calls | Median time | 90th pct. | Median result (chars) |
| ---------------------------- | ----: | ----------: | --------: | --------------------: |
| `transitionJiraIssue`        |   588 |       5.4 s |    28.2 s |                    91 |
| `getJiraIssue`               |   504 |       2.2 s |     5.1 s |                 4,602 |
| `createJiraIssue`            |   387 |       8.5 s |    29.2 s |                 4,122 |
| `searchJiraIssuesUsingJql`   |   239 |       2.1 s |    10.6 s |                 6,193 |
| `editJiraIssue`              |   231 |      18.6 s |    28.8 s |                 5,797 |
| comments (add, edit, list)   |   121 | 6.3 s (add) |    14.7 s |           3,294 (add) |
| `getTransitionsForJiraIssue` |    54 |       1.9 s |     4.4 s |                 4,435 |
| other                        |    15 |           — |         — |                     — |

- **Time:** 560 minutes of wall time in total, median 4.1 s a call. Per session: median
  **9 s**, 90th percentile 376 s.
- **Size (proxy for tokens):** 8.97 million characters of results, about 2.2 million tokens
  at 4 characters a token. Per session: median 13,285 characters (about 3,300 tokens), 90th
  percentile 119,602 (about 30,000).
- **Where it goes:** a third of the calls (642 of 2,139) are status moves and their lookups;
  387 create cards. A single `getJiraIssue` returns about 4,600 characters with the default
  fields, which is most of the size bill and is under the caller's control.

## How often the server failed

**Calls:** 46 of 2,139 failed on infrastructure — the call timed out, the server did not
respond, the app was reported as not installed, or the connection closed. Another 13 matched
the script's failure markers but were not the server's: a missing argument, a transition not
given, a permission denied, and a few successful responses the markers caught.

**Sessions:** 15 of the 166 top-level sessions that called Jira met at least one
infrastructure failure.

**Days:** failures fell on 10 of the 32 days. **26 on 21/10 and 8 on 22/10**; no other day had
more than 3. The same two days hold 73 of the 84 calls that took over 60 s. Counting both the
failed calls and the ones over 60 s, 91 calls account for **288 of the 560 minutes**.

Fallback to the second Atlassian connector (the one the project memory names) could not be
counted: the connectors appear in this window under opaque server ids, so a fallback is not
distinguishable from a retry in the transcript. Each session with failures is counted once,
however many times it retried.

## What depends on Jira

Read in the code, not executed.

| Where                                          | What it needs from Jira                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `AGENTS.md` › Workflow                         | "Take the highest-priority card in Ready"; move to Review; never to Done                                  |
| `/next-card` and its Codex port                | A Ready query, `blocked-by-*` labels, a status move                                                       |
| `/coordinate` and its Codex port               | Batch membership as a `batch-<name>` label, open-card JQL, Ready/Review moves, card creation with an epic |
| `/handoff` and its Codex port                  | Card notes written to Jira; the status each moved card sits in                                            |
| `/new-template` and its Codex port             | A card under an epic, moved to Review                                                                     |
| `docs/agents.md`                               | The Atlassian MCP server as a setup step for Codex                                                        |
| `commitlint.config.js`, `docs/git-workflow.md` | The `TYTO-<n>` **shape** of the key, not Jira itself                                                      |
| `tools/repo-checks/src/e2e-budget.mjs`         | A waiver's owner `card` must match `TYTO-<n>`                                                             |
| `.github/pull_request_template.md`             | A `TYTO-` placeholder                                                                                     |

What does **not** depend on Jira is the key. **573 of 581 commits on `main`** carry a
`TYTO-<n>` key, and 1,079 tracked files cite 411 distinct keys, but every check reads the shape
of the key and none calls Jira. A migration that kept the numbers would leave all of that
valid. No tracked file links to a card's URL; the five `atlassian.net` hits are example values
in plugin documentation.

## The precedent: the batches repository

The batches repository has taken **1,049 commits since 09/10, with 0 merge commits**, from
sessions that pull before reading and push after each change. Of the 130 transcripts that
mention it, 1 contains a rejected push. So a private Markdown repository driven by many
concurrent agent sessions works at this project's pace, and it is measured, not assumed. What
it does not show is the time each pull and push costs; that was not measured.

## What a migration would lose and gain

Lost, each read rather than measured:

- **The board.** Ready is a column the maintainer drags cards into; a folder of files has no
  drag. A status field in each file, or a folder per status, gives the data but not the gesture.
- **JQL.** The commands query by status, label and epic. `grep` over front matter covers the
  queries in use today; it does not cover ad-hoc ones the maintainer types into Jira.
- **Status history.** Jira keeps it; `git log` on the file would keep it too, as commits.
- **Reading on a phone.** A private repository's Markdown is readable in GitHub's mobile app;
  editing it there was not tried.
- **The migration itself:** 601 cards, 26 epics, labels and links converted, and every
  command and its Codex port rewritten in one PR pair.

Gained:

- **One tool and one connector fewer**, and with them the 46 failures and the 288 slow
  minutes, replaced by git's own failure modes (one rejected push in the batches repository).
- **Cards reviewed in PRs**, and `grep` across cards, offline.
- **Size control.** A card file is as long as its text; nothing returns 4,600 characters of
  envelope around a summary.

The Review drift is **not** a gain of the migration: a file's status field needs somebody to
close it just as a Jira card does.

## Recommendation

**Keep Jira, and spend the effort where the numbers point.**

1. **Make the calls smaller.** Pass `fields` and `responseContentFormat: markdown` in the
   commands' reads, and use `searchResultMode: count` where only a count is needed. This
   attacks the 2.2 million-token proxy without touching the workflow. A candidate card,
   reported to the batch coordinator rather than created.
2. **Close the Review backlog.** 122 cards sit in Review, the oldest 20 all merged. Moving
   cards to Done is the maintainer's call (`AGENTS.md`); the study only reports the number.
3. **Write down the fallback rule** the project memory holds: at the second failure, switch
   connectors instead of retrying. It is known to sessions that load the memory, not to Codex.

## What would change the answer

- **Another incident like 21–22/10 within a month**, or infrastructure failures above 5 % of
  calls over 30 days (today 2.2 %).
- **Losing the Jira site**, or its connector, for longer than a working day.
- **The maintainer no longer using the board** — if Ready is chosen by asking an agent, not by
  dragging, the board's main reason to exist is gone.
- **Token cost becoming the bottleneck** after the calls are trimmed: if the 90th-percentile
  session still spends over 30,000 tokens on Jira, the size argument for files gets stronger.

Measured again with the same script, any of these would reopen the question.
