# 0034 — The quit question has three answers, and the third one is a channel of its own

Status: accepted · 2026-09-20 · decided by TYTO-153 · amends the two-way box of ADR 0029 and
ADR 0031, whose staging and deadlines are untouched

## Context

ADR 0029 gave main a way to ask the window a question and ADR 0031 made the answer wait for a
person. What neither of them changed is **what the box offers**, and it offered two things:

```
Sair sem salvar?
3 abas têm alterações que ainda não foram escritas no disco

   [ Cancelar ]   [ Sair sem salvar ]
      default
```

Lose the work, or stay. The third answer — _save, then go_ — is the one almost everybody who
hits the X by mistake wants, and it was not on screen. Every editor these people have used
offers it, so its absence does not read as a deliberate omission; it reads as an app that
cannot save.

The machinery was already there. `documents.save` falls back to Save-As when a document has no
path (E9.8), `file:save` carries the flag, and `saveDocument(saveAs)` has been a renderer
command since TYTO-124. What was missing was the question and what to do with each answer.

## Decision

**Four decisions, and the first one is the only one that changes a shape on the wire.**

### 1 — A channel of its own, `dialog:save-changes`, and not a widened `dialog:confirm`

`dialog:confirm` is a two-button channel whose response is a boolean. Three ways of widening it
were available and one new channel was cheaper than all of them:

- **A third, optional label on `confirm`.** Its five existing callers would carry a field they
  never set and a response that is no longer a boolean, and the two boxes disagree about which
  button is safe — `confirm` points `defaultId` and `cancelId` at the same index on purpose,
  and this box points them at two different ones.
- **A generic `dialog:message` carrying `buttons: string[]`.** It fits every future box, which
  is the objection: the renderer would then decide how many buttons main draws and what each
  index means, putting the map from an answer to an act on the wire instead of in the two files
  that hold it.
- **The renderer drawing its own three-button box.** Rejected for ADR 0029's reason, unchanged:
  the browser's buttons come in the OS's language, not the one the footer picker chose.

The new channel carries three translated labels and answers with a **meaning** —
`'save' | 'discard' | 'cancel'` — never an index. Main builds the button order, so main is
where an index is read back. Both sides validate, as ADR 0029 requires.

### 2 — One box for the whole quit, and **Sim** then walks the tabs

Photoshop and Word ask per document. That would mean three questions before anything happens
for somebody with three untitled tabs; asking once and then showing one Save-As per pathless
tab is the same number of pickers and two fewer questions. The saves run **in order and one at
a time**: each can open a file picker, and three pickers at once is not a thing a person can
answer.

### 3 — Anything short of every tab written cancels the quit

A save that failed and a Save-As the person dismissed both leave the app standing with its text
in it, and a failure says so in the problems panel, where TYTO-124 already puts them. Quitting
after a failed save would be the app deciding to discard on somebody's behalf, having just been
told to save — the class of bug ADR 0031 exists to have closed, wearing the label of a feature.

### 4 — **Sim** is the default and **Cancelar** is the Escape key

This reverses the box's old defaulting, where Cancel was both. It is safe to point Enter at an
action here because the action cannot lose anything: the two keys a person hits without reading
now either write the work or keep it. `dialog:confirm`'s own rule is untouched — both of its
answers can cost a document, so both of its keys stay on the safe one.

## Consequences

- **The wait gets much longer, and ADR 0031 is what makes it possible.** After **Sim** there
  may be several Save-As dialogs, each one a person choosing a folder and a filename. The
  unbounded wait is what holds that; any future card that puts a deadline back over the answer
  breaks this one.
- **A failed save now has to be an answer rather than an exception.** `file:save`'s rejection
  used to be re-thrown from the Save command so that `installErrorReporting` would file it, and
  a caller that must know the outcome cannot be handed an exception to let past. The report is
  made directly instead (`reportToLog`), and the sentence in the problems panel is unchanged.
- **The renderer saves tabs that are not in front.** `contentOf` answers for any document in the
  workspace — the state is the store's since TYTO-115 — so nothing is activated on the way out
  and nobody watches the app flick through three tabs as it closes.
- **The decision is a unit again.** `src/renderer/exit.ts` holds the three-way answer and knows
  nothing about CodeMirror, the catalogue or the preload, which is `src/main/quit.ts`'s
  arrangement on the other side of the same question. What the end-to-end suite adds is that
  the processes are wired to each other; what the unit holds is that a dismissed picker is not
  a save.
- **The catalogue keys were renamed** from `exit.discard.*` to `exit.save.*`, because the box no
  longer asks about discarding. Five strings became six.
- **One question still covers one window.** ADR 0029's bullet about a second window is untouched
  and still unanswered.
