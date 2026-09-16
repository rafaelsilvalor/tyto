Prepare this session to be cleared, then propose a name for the next one.
If $ARGUMENTS names a topic, assume that is what the next session will pick up.

Start no new work. Commit and push only what an earlier instruction already
asked for — this command preserves and reports, it does not decide. Step 3 is
the one thing it does, and only because that decision was already taken.

1. **Leave nothing that lives only in context.** Anything still true after the
   clear goes somewhere durable first: a decision into an ADR or a doc, a fact
   about a card into Jira, a lasting preference or project constraint into the
   memory directory. Skip whatever the repo, the git history or Jira already
   records — a clear does not erase those.

2. **Say what is unfinished, with the evidence, not a summary:**
   - working tree: uncommitted files, unpushed commits, branch versus upstream
   - open PRs, their draft state and their checks
   - Jira cards this session moved, and the status each sits in now
   - anything started and not finished, background tasks included

3. **Delete the dead branches**, every time. A local branch whose pull request
   is `MERGED` or `CLOSED` goes; this is settled, not a judgement call. Three
   things make it safe, and the second earned its place by catching one branch
   in twenty-one:
   - **Ask the pull request**, never the diff against `main`
     (`gh pr list --state all --head <branch>`). A squash merge leaves every
     merged branch looking full of unmerged work.
   - **Compare the local tip with the pull request's head.** A commit pushed
     after the merge never travelled in it. If they differ, fetch
     `refs/pull/<n>/head` and check `git merge-base --is-ancestor <branch>
<prHead>`: an ancestor is merely behind, and anything else is a local
     commit that never went through review — confirm its content reached `main`
     before deleting.
   - `git branch -D`, because `-d` refuses every squash-merged branch.
     Say which branches went, and name any that were kept and why.

4. **Flag what would be expensive to rediscover.** A measurement that took real
   time, a wrong turn worth not repeating, a tool whose output misled. One line
   each; omit the section if there is nothing.

5. **Propose one name for the next session**, not a menu:
   `TYTO-<key> <short slug>` when the next step is a card, otherwise three to
   five words naming the topic.

6. End with the single next action and whose it is.

Report in Portuguese. Never run `/clear` yourself — say when it is safe to.
