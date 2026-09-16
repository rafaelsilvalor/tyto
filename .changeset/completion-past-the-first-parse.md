---
'@tyto/editor': patch
---

TYTO-114 — completion stops going silent past the first 3 000 characters

A test that failed 2 runs in 9 turned out to be the visible half of a defect that is
deterministic on any document long enough to have the problem.

**`syntaxTree(state)` returns whatever the last parse finished, which is not the whole
document.** CodeMirror gives the initial parse a viewport of `Math.min(3000, doc.length)` and
a 20 ms budget, and on expiry `takeTree()` truncates the tree wherever the parser stopped
(`@codemirror/language/dist/index.js:540`). Past that point `resolveInner` answers with the
top node instead of the node the cursor is in, every reader falls through to its `default:`,
and the author gets nothing — which reads as "no suggestions" and is really "no tree".

Measured on real documents, before the fix:

| document          | length | tree      | node at cursor | suggestions       |
| ----------------- | ------ | --------- | -------------- | ----------------- |
| 200-line brief    | 2 942  | 2 942     | `Adjustments`  | `destaque`, `tom` |
| 400-line brief    | 5 942  | **3 013** | **`Brief`**    | **none**          |
| 200-line template | 4 103  | **3 005** | **`Template`** | **none**          |

**Five readers shared the defect**, not one: brief completion, template completion in three
places (the tag list, the stylesheet test and the open-quote walk), and the template linter's
"which tag is this attribute on" climb. All five now go through `treeAt(state, upto)`, which
asks `ensureSyntaxTree` for a tree that actually reaches the position and falls back to the
partial one if a 100 ms budget is not enough — today's behaviour, degraded rather than broken.

The budget is measured rather than picked: forcing the parse to the end of a 14 942-character
brief costs 5.9 ms, and to the end of a 20 903-character template 6.8 ms.

**The 20 ms is wall clock, not CPU time**, which is the other half of the same defect and the
reason it first appeared as a flake: a worker descheduled under load blows the budget on a
document of any size. That is why the test failed only when the other eleven files in the
package ran beside it, and never when it ran alone.
