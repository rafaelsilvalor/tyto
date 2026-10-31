# 0163 — The bottom area is one strip of tabs, one panel shown

Status: accepted · 2026-10-30 · TYTO-496 · supersedes in part ADR 0045 (the bottom dock's panels
side by side) and ADR 0090 (decision 3's switcher, now built)

## Context

TYTO-496's first panel put the command panel beside Problems, the two side by side in the bottom
area, as ADR 0045 laid out the bottom dock for TYTO-49. The panel had a row of session tabs, a
boxed input line and a hairline between each part. Rafael looked at it on 2026-10-30 and wrote:

> "Gostaria que os comandos fossem mais uma aba do painel inferior. assim como no vscode. retire
> a caixa onde os cammando são digitados quero o design o mais limpo possivel. deira a linhas que
> separam as areais o mais sutil possivel, clean."

In English: "I would like the commands to be one more tab of the bottom panel, as in VS Code.
Remove the box where the commands are typed; I want the design as clean as possible. Make the
lines that separate the areas as subtle as possible, clean."

He sent a screenshot of VS Code's bottom panel with it: tabs named Problems (with its count),
Output, Debug Console, Terminal and Ports, one shown at a time, and the terminal's prompt inline
with no box.

## Decision

1. **The bottom area is one strip of tabs.** Every open panel docked at the bottom is a tab, in
   the layout record's order: Problems, Commands, then Project and any plugin panel that docks
   there. **Only the tab in front is drawn**, and the others' elements are not created (ADR 0024).
   The strip takes the place of the panel's title (`.tool__title`, the hook ADR 0090 decision 3
   kept for a switcher), and the panel in front keeps its own actions at the right. The left and
   right areas still stack their panels.
2. **The tab in front is remembered** in `layout.json` as `front.bottom`. The field is optional:
   a file written before it reads, with the first open panel in front, and an id naming no open
   panel is ignored. Opening a bottom panel puts it in front.
3. **A tab carries its count**: Problems shows the window's one problem count, which is the
   status bar's, on its tab, as VS Code does.
4. **The area keeps one height.** It is as tall as its tallest open tab, and a drag on its edge
   gives that size to every open tab, so changing the tab in front never moves the editor.
5. **The × hides the whole area**, as VS Code's does, and every tab is there when it comes back.
   A panel's toggle (a key, the command bar, the status bar) shows the area on that tab, and the
   tab already on screen hides the area.
6. **The command panel has no input box.** The prompt `tyto ›` is the last line of the output,
   with nothing drawn around what is typed, and the caret is what shows where typing goes. Its
   sessions show as small tabs at the right of the strip only when there is more than one, and
   Stop only while something runs. Inside the panel no line separates its parts.

## Consequences

- The bottom area no longer splits its width between two panels. A person sees Problems or
  Commands, one at a time, with a click or a key between them.
- A built-in panel's heading id and key move onto its tab (`#problems-heading`,
  `problems.heading`), so the window's translation pass still writes it and nothing that found it
  by id has to change.
- TYTO-267 left the window one problem count, the status bar's. Decision 3 adds a second place
  for it: Problems' tab shows the same number, painted with the bar, and
  `e2e/preview.desktop.test.ts` holds the two equal.
- A panel that shares the area, like Project, is drawn only while its tab is in front. Anything
  that reads Problems' rows has Problems in front first.
- Problems' own 140 px default no longer sets the area's height while the command panel is open:
  the command panel's 240 px does.
- The command panel's output has no font area of its own (ADR 0099). It follows the UI text size.

## Rejected

- **Keeping the panels side by side and only removing the input box.** Rafael asked for a tab,
  as in VS Code.
- **A per-area height stored apart from the panels.** It would have been a second number to keep
  in step with each panel's `size`. The tallest open tab gives one height with no new field.
