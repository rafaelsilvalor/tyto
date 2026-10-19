# 0105 — End-to-end tests are for what needs the real window

Status: accepted · 2026-10-19 · TYTO-310

## Context

`test:desktop` on CI grew from 143 s (06/10) to 495 s (18/10), about one suite per card, and
nothing noticed. A green run looks the same whether a file takes two seconds or two minutes.
Two files added during editor-ergonomics, `tab-drag` (141 s) and `sticky-scroll` (121 s), were
a sixth of the serial sum on their own. Sharding (ADR 0100) and the local selector (TYTO-309)
make the same growth cheaper to wait for; neither makes it visible, and neither costs the author
of the next slow file anything.

Two things make a desktop e2e file slow, and only one of them is the window. A file launches
Electron in `beforeAll` and closes it in `afterAll`, and a hidden window paints about one frame a
second (ADR 0104). Every assertion it makes pays for that real window, including the assertions
that never needed one: the order of a list, how a brief parses, which state a click moves to.
Those run in milliseconds in a unit test in `packages/*` or in the renderer's jsdom tests.

**The distribution, after TYTO-291.** Each file's time with its hooks, from vitest's own
per-module duration, on three green runs of the 77 files (561 tests): `main` at e30d6c8 (run 39254557507) and PR #111's last two runs (39253784784, 39251162930).

| Measure                                | Seconds     |
| -------------------------------------- | ----------- |
| median file                            | 12.5        |
| p90                                    | 26.1        |
| p95                                    | 35.3        |
| slowest file, `keybindings` (11 tests) | 43.8        |
| next, `status-bar` (13 tests)          | 42.2        |
| summed over a run                      | 1,119–1,148 |

No file is over 60 s on any of the three runs.

**Which duration.** vitest's JSON reporter gives each file the sum of its tests, which leaves out
`beforeAll` and `afterAll` — where Electron launches and closes, the cost this is about. vitest
5's `runSuite` starts the clock for a file before `beforeAll` and stops it after `afterAll` and
the fixture cleanup, and `TestModule.diagnostic().duration` is that number. The default
reporter's lines show it too, but parsing a log format the repository does not own was refused.

## Decision

**A desktop e2e test asserts only what needs the real window: layout and pixels, focus, keys
reaching the app, IPC between processes, and the packaged app.** Ordering, parsing, state
transitions and other logic are tested at unit level in `packages/*` or in the renderer's jsdom
tests, and the e2e test checks once that the wiring reaches them. The rule lives in
`docs/conventions.md` › Tests, is pointed to from `CLAUDE.md` and `docs/architecture.md`, and is
in the executor prompt of `.claude/commands/coordinate.md`.

**Each file has a 60 s budget on CI, and CI enforces it.**

- `apps/desktop/e2e/durations-reporter.ts` writes `[{ file, tests, durationMs }]` to
  `blob-reports/durations.json`. It runs in the `merge` job of `desktop-e2e.yml`, beside the
  default reporter, on the shards' blobs. So it sees all 77 files in one list, and it costs no
  launch.
- `tools/repo-checks/src/e2e-budget.mjs` reads that file against
  `tools/repo-checks/src/e2e-budget.json` in a step of the same job, under `!cancelled()`. A file
  over its ceiling prints `::error file=apps/desktop/<file>::<file> took N s, ceiling M s` and
  the step exits 1, so `merge` is red and `desktop` with it. A report it cannot read is red too.
- The job summary lists the ten slowest files with tests, seconds, seconds per test, ceiling and
  waiver. **Seconds per test is reported and never enforced**: a file of twenty quick tests and
  a file of one slow test can weigh the same, and the column is there for a reviewer to tell
  them apart.
- **Over the budget is a waiver, not a bigger number.** A waiver names the file, its own
  ceiling, an owner card and the reason. A waiver whose file is back under 60 s is flagged as
  stale, as a warning. It ships with no waivers, because no file is over.

**Why 60 s.** It is 37 % over the slowest file measured (43.8 s), so the run-to-run spread seen
here (`quit` 28.5–35.7 s, `tabs` 28.6–35.6 s) does not trip it. It is still under half of what
`tab-drag` took before TYTO-291 (141 s), so a file that waits on frames, or launches Electron per
test, is caught on the pull request that adds it.

**A step in `merge`, not a job.** The durations are already in that job, and
`github-config.test.ts` pins the job graph: every job but `desktop` needs `scope`, and `desktop`
rolls them all up. A job of its own would download the blobs a third time for nothing.

## Consequences

- A pull request that adds a slow file is red by name, and its author chooses between moving the
  logic to a unit test and asking for a waiver with a card.
- The budget is per file, not per run. Many small files still add up, and the run's sum is in
  the summary, unenforced.
- The numbers are CI's. A maintainer's machine runs one file at a time and is not held to it.
- Not done here: the slow files' logic is not moved out. `keybindings`, `status-bar` and
  `format-brief` are the three nearest the ceiling, and ADR 0104 measured that most of their
  time is frames, which its shared switch would cut once the vim Escape case is settled.
