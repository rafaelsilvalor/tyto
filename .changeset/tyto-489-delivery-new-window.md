---
'@tyto/core': patch
'@tyto/io': patch
'@tyto/desktop': minor
---

**File ▸ Delivery: New…** (`delivery.new`) makes a delivery in the open folder from the window (TYTO-489, ADR 0157): the command bar asks for its name, saying as you type why a name cannot be a folder's, then for a template or none; main makes the folder and the brief, which opens in a new tab and is selected in the Explorer, with the "/" menu when no template was chosen. A refusal is said in the status bar. A delivery a link inside the workspace would carry outside it is now `E_DELIVERY_PATH_OUTSIDE` instead of `W_PROJECT_PATH_OUTSIDE`, whose text is about an untrusted folder's key.
