Turn one or more ideas into TYTO Jira cards in the house format. $ARGUMENTS is the idea, in
the maintainer's words (Portuguese or English); several ideas make several cards in one pass.
If $ARGUMENTS also says the cards belong to a batch, it names that batch.

The rules here are AGENTS.md › Language and the project's practice: a card says why it exists,
has a parent epic, does not duplicate an open card, and its status is read after creation.
**Nothing is created before the maintainer approves the draft.** Talk to him in Portuguese;
the card itself is in English, except its Portuguese half.

Jira is project `TYTO`. Every read passes `fields` with only what the step uses and
`responseContentFormat: "markdown"`; a count uses `searchResultMode: "count"`. A read without
`fields` returns the whole description of every card, which is most of what a Jira call costs,
and `parent` brings the epic's status, priority and type with every card: ask for it only in
step 7. A failing call follows AGENTS.md › Operational rules › Jira (connector fallback).

1. **Read the idea against the code.** Grep the files, packages, commands or settings the idea
   names, and say what exists today in one or two lines per idea. A premise may be stale: if
   the code already does it, say so and stop for that idea.

2. **Search open cards for an overlap.** Take two or three distinctive words of each idea and
   search the open cards:

   ```text
   project = TYTO AND statusCategory != Done AND issuetype != Epic AND text ~ "<words>"
   ```

   with `fields: ["summary", "status"]`. Show at most the 5 closest cards with key,
   title and status, and **the JQL you ran**, so a search that missed is visible. When one of
   them already covers the idea, name its key and propose a comment or an edit to it instead
   of a new card. A word search can miss a card that says the same thing in other words: when
   the idea is broad, read the titles of the open cards in its epic too (step 3).

3. **Pick the epic.** List the open epics at run time; they change, so never write one from
   memory:

   ```text
   project = TYTO AND issuetype = Epic AND statusCategory != Done
   ```

   with `fields: ["summary"]`. Pick the epic whose summary covers the idea and say which. When
   none fits, ask the maintainer: an existing epic or a new one. Never invent an epic key, and
   never leave a card without one.

4. **Draft each card.** The title is English, an imperative or a claim, at most about 80
   characters. The body is Markdown, in this order:

   ```markdown
   ## Why this card exists

   <The maintainer's words, quoted, with the date (dd/mm). What is broken or missing, and
   why no open card covers it (name the closest one from step 2).>

   ## What

   <What changes, naming files and packages; what the grep of step 1 found.>

   ## ADR

   <The ADR it needs, or "None expected".>

   ## Depends on

   <Card keys, or "Nothing".>

   ## Done

   <How a reviewer knows it is finished: tests, evidence, docs.>

   ---

   <Portuguese half>
   ```

   The Portuguese half is **not a translation**: the maintainer reads English, so translating
   the body buys nothing. It explains, for somebody who does not write code, what the card
   adds to Tyto: one concrete example of what a person can do afterwards that they could not
   do before, and one sentence on what still does not work. Three sentences to a short
   paragraph. Leave out a section with nothing to say, except Why and Done.

   Labels: a `batch-<name>` label only when the caller said the card belongs to that batch;
   otherwise none.

5. **Show the drafts and wait.** For each card: title, epic (key and summary), labels, the
   overlap search of step 2 and the full body. Create nothing until the maintainer approves;
   a reply that corrects a detail is not an approval, so show the corrected draft again.

6. **Create on approval.** `createJiraIssue` with `projectKey: "TYTO"`,
   `issueTypeName: "Task"`, `parent: "<epic key>"`, `contentFormat: "markdown"`, the body as
   `description`, and the labels in `additional_fields: { "labels": [...] }` when there are any.

7. **Re-read and report.** A new card lands in Ready or To Do unpredictably, so read it back:

   ```text
   key in (<new keys>)
   ```

   with `fields: ["summary", "status", "parent", "labels"]`. Report each card's key, title,
   status and epic. Ready is where the maintainer drags what he wants worked: a card that
   landed there without a reason goes back to To Do (`transitionJiraIssue`, transition `11`;
   Ready is `2`), and the reply says so. A card he asked to be worked next stays in Ready.

Editing a card later: `editJiraIssue` replaces `labels` whole, so read the current labels first
and send the full list.
