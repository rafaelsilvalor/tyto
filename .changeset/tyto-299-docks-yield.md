---
'@tyto/desktop': patch
---

TYTO-299: editor groups no longer overlap when the window is too narrow. Each split is held at its groups' minimum size, and the side and bottom docks give way first, down to 160 px across or 96 px tall (or their own smaller size); the sizes saved in the layout are unchanged, so a wider window gives them back. When even that is not enough, the last groups are clipped at the editor's edge instead of being painted over each other or pushing a dock out of the window.
