---
'@tyto/desktop': patch
---

TYTO-153 — closing the app with unsaved tabs now offers **Sim**, **Não** and **Cancelar**, the way
every editor does, instead of offering only two answers of which neither saved.

The box used to ask _Sair sem salvar?_ and give you two ways out: lose the work, or stay in the
program. The answer almost everybody wants after hitting the X by mistake — save it, then go — was
not on screen at all. Its absence does not read as a deliberate choice; it reads as an app that
cannot save.

It asks _Deseja salvar o trabalho?_ now. **Sim** writes every dirty tab and then quits, opening a
Save-As dialog for each tab that has never been saved, so three untitled tabs mean three file
pickers and one question rather than three questions. **Não** quits without saving, which is what
the old confirm button did. **Cancelar** puts you back in the editor with everything exactly as it
was, and the app still quits normally on the next attempt.

**Anything short of every tab being written cancels the quit.** A save that fails — a full disk, a
folder gone read-only — leaves the app up and says what went wrong in the problems panel, where
save failures have gone since TYTO-124. So does a Save-As you dismiss, which is how somebody
changes their mind halfway through an answer. Quitting anyway would be the app discarding the work
of somebody who had just asked for it to be kept, which is the bug TYTO-147 closed wearing the
label of a feature.

**Enter saves and Escape stays.** That reverses the old box, where the default was Cancel, and it
is safe here for a reason the old one did not have: neither of those two keys can now cost you a
word. The tab-closing box is unchanged and still points both keys at the safe button, because both
of its answers can lose a document.

The third button needed a shape the app did not have: `dialog:confirm` is a two-button channel
whose answer is a boolean. It travels on a channel of its own, `dialog:save-changes`, rather than
on a widened `confirm` or on a generic "draw me these buttons" message — the renderer never sees a
button index, because main builds the button order and reading an index back belongs where the
order is. ADR 0034 records that and the three other decisions inside this card; ADR 0031's staging
and its deadlines are untouched, and its unbounded wait is what makes a quit with three file
pickers in it possible at all.

Also here, because the quit question needed it: a failed save is now an answer rather than a
re-thrown exception, and the line in the log is written directly. The sentence in the problems
panel is unchanged.
