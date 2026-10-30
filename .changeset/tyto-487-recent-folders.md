---
'@tyto/desktop': minor
---

Recent project folders in the title bar (TYTO-487). A button after Help names the open folder and opens a popover of the folders opened before, newest first: type to filter, arrows and Enter to open, Escape to close, and Open Local Folder… at the foot. A folder chosen there opens through File ▸ Open Folder's own door, with the same trust rules (ADR 0111) and one folder per window (ADR 0113). The command `workspace.openRecent` opens the same popover and can be bound in `keybindings.json`. Main keeps the last ten folders in `recent-folders.json` beside the recent files and hands the window ids, never paths.
