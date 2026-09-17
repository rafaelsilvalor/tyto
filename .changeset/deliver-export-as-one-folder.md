---
'@tyto/io': minor
---

TYTO-121 — deliver an export as one folder: `fsDeliveryOutput`

A second `TaskOutput` beside `fsTaskOutput`, for an export somebody sends to another person
rather than to a program. It writes `<destination>/<name>/` with the artwork at the top and
the brief and `result.json` underneath, in `editaveis/`:

```
<destination>/<name>/
  <artwork>-<format>.png
  editaveis/
    <name>.brief
    template.txt
    result.json
```

**`template.txt` names the template and never carries it.** `describeTemplate` writes the
name, the version and the template's own description, plus a sentence saying the template
lives in a repository and not in this folder. A copy per delivery would fill a remote with
duplicates of a file that has one home and make "which version is the real one" a question;
what a delivery owes its reader is the identity of the version that produced these exact
files. It is a separate call rather than an option because the answer is not known when the
output is opened — the run resolves it — and it goes in before `finish`, so `result.json`
stays the last file to appear.

**The top level holds artwork and nothing else, and that is the whole of the layout.** A
folder with a report in it is a folder somebody tidies before sending it on, and the one file
they would delete is the one file ADR 0011 says never to move. So it goes down a level, where
a reader of `editaveis/` still finds it exactly where they expect. The brief goes down there
with it, so a request to change a word two weeks later finds the text that made the images
instead of a folder of pictures with no source.

**Nothing about `--out` moved.** `fsTaskOutput` is unchanged and `tyto render --out <dir>`
writes into exactly the directory named, which is what `docs/render-contract.md` publishes and
what Jacurutu reads. The two adapters now share one copy of the writing — the atomic rename,
the schema check, `result.json` last — because two copies would be two ways for a half-written
PNG to reach a watcher.

**The name is the caller's and is not sanitised**: it comes off a file that already exists on
the filesystem, and a second sanitiser beside `artifactName`'s is how one folder ends up called
two things. A name that is not a single path segment is **refused** rather than rewritten.

**An existing folder is written into, not cleared** — the same rule `--out` has. What that
costs is worth knowing: a brief edited from three slides down to two leaves the third one in
the delivery, and `result.json` does not mention it, because it lists what that run wrote.
