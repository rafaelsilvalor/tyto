---
'@tyto/desktop': patch
---

Clicking a slide's thumbnail in the preview right after editing the brief now puts the
cursor on that slide's line. It used to land on a neighbouring slide when the edit had
changed the text's length and the preview had not redrawn yet. The "Preview: next slide" and
"Preview: previous slide" commands had the same fault and are fixed with it.
