---
name: handoff
description: Prepare a Tyto Codex thread to be closed or compacted, then propose a name for the next thread. Use when the maintainer asks to wrap up, hand off, "fechar a sessão" or "preparar para limpar". Starts no new work.
---

# Handoff

Codex port of `.claude/commands/handoff.md`. Keep the two in step.

Prepare this thread to be closed, then propose a name for the next one. If the request names a
topic, assume that is what the next thread will pick up.

Start no new work. Commit and push only what an earlier instruction already asked for: this
skill preserves and reports, it does not decide. Step 3 is the one thing it does, and only
because that decision was already taken.

1. **Leave nothing that lives only in context.** Anything still true after the thread closes
   goes somewhere durable first: a decision into an ADR or a doc, a fact about a card into
   Jira, a lasting preference or project constraint into the user's personal agent notes (the
   home `AGENTS.md` names where). Skip whatever the repo, the git history or Jira already
   records.

2. **Say what is unfinished, with the evidence, not a summary:**
   - working tree: uncommitted files, unpushed commits, branch versus upstream;
   - open PRs, their draft state and their checks;
   - Jira cards this thread moved, and the status each sits in now;
   - anything started and not finished, background commands included.

3. **Delete the dead branches**, every time. A local branch whose pull request is `MERGED` or
   `CLOSED` goes; this is settled, not a judgement call. Three things make it safe:
   - **Ask the pull request**, never the diff against `main`
     (`gh pr list --state all --head <branch>`). A squash merge leaves every merged branch
     looking full of unmerged work.
   - **Compare the local tip with the pull request's head.** A commit pushed after the merge
     never travelled in it. If they differ, fetch `refs/pull/<n>/head` and ask whether the
     branch is an ancestor of it (`git merge-base --is-ancestor`): an ancestor is merely behind,
     and anything else is a local commit that never went through review. Confirm its content
     reached `main` before deleting.
   - `git branch -D`, because `-d` refuses every squash-merged branch.

   Say which branches went, and name any that were kept and why.

4. **Flag what would be expensive to rediscover.** A measurement that took real time, a wrong
   turn worth not repeating, a tool whose output misled. One line each; omit the section if
   there is nothing.

5. **Propose one name for the next thread**, not a menu: `TYTO-<key> <short slug>` when the
   next step is a card, otherwise three to five words naming the topic.

6. End with the single next action and whose it is.

Report in Portuguese. Never close or compact the thread yourself; say when it is safe to.
