---
'@tyto/desktop': minor
---

TYTO-287: the preview is a tab. Ctrl+Shift+V (or the button at the end of a brief's tab row, the View menu or the command bar) opens "Preview <name>" in the group to the right, and the preview follows whichever brief you bring to the front, as VS Code's Markdown preview does; "Lock" in its bar pins it to one brief, so two briefs' art can sit side by side. The PREVIEW panel and the right area's status-bar button are gone. A click in a preview focuses it, and export, Save and the problems panel act on the brief it shows. For now a new window opens with no preview until you ask for one, and the preview is not kept across a restart.
