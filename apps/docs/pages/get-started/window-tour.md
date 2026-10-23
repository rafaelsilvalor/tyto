# Tour of the window

The names on this page are the ones the rest of the manual uses. The picture shows a brief open on the left and its preview on the right, as the window looks after [your first artwork](./first-artwork.md).

<!--
  The markers are percentages of the `window-tour` picture, placed by eye. They do not move when
  the picture does: after `pnpm --filter @tyto/desktop shots` regenerates it (scene list in
  apps/desktop/e2e/docs-shots/scenes.ts), look at this page in both editions and move them.
-->

<Screenshot
  scene="window-tour"
  alt="The Tyto window with a brief in the left editor group, its preview in the right one, the problems panel below and the status bar at the bottom."
  :markers="[
    { n: 1, x: 33, y: 2 },
    { n: 2, x: 12.5, y: 6 },
    { n: 3, x: 6, y: 9 },
    { n: 4, x: 35, y: 37 },
    { n: 5, x: 67, y: 6 },
    { n: 6, x: 62, y: 9.25 },
    { n: 7, x: 7.5, y: 81.5 },
    { n: 8, x: 47, y: 97.5 },
  ]"
/>

1. **Title bar** — the menus (**File**, **Edit**, **View**, **Window**, **Help**) and the name of the file in front. On macOS the menus and the title are the system's, at the top of the screen.
2. **Tab** — one for each open file. A tab with changes not yet saved says so; closing it asks first. Rest the pointer on a tab to see where its file is: inside the open folder the path starts with the folder's name, as `promo\briefs\capa.brief`, and elsewhere your home folder is written `~`.
3. **Breadcrumb** — where the cursor is in the brief: `header` in the lines between the two `---`, or the block it is in. Resting the pointer on its row shows where the file is, as on the tab.
4. **Editor group** — a row of tabs and the file in front. **Split editor right** (**Ctrl+\\**) divides a group in two, and the button at the right end of the tab row opens the preview in a group of its own; the picture has two groups side by side.
5. **Preview** — a tab like any other, in the second group. It draws the brief beside it as you type, and while the brief has an error it keeps the last drawing that worked.
6. **Preview toolbar** — the formats the brief asks for (one chip each), **One slide** and **All slides** and the slide strip's toggle for a carousel, zoom, **Fit**, and **Lock**, which keeps the preview on this brief when you switch tabs.
7. **Problems panel** — what is wrong with the brief in front, each with its line and column; click one to go there.
8. **Status bar** — the line and column of the cursor, the kind of tab, the brief's template, the number of problems, and buttons for the queue, plugins, export, settings and the areas of the window.

## The command bar

Everything the app does is a command, and **Ctrl+K** (**Cmd+K** on macOS) opens the bar that runs them: type a few letters of what you want and press Enter. The keys a command has are shown beside it. The button at the left end of the status bar opens the same bar. Every command and its key is listed in [Commands](../reference/commands.md).

<Screenshot
  scene="command-bar-open"
  alt="The command bar open over the editor, listing commands with their keys."
/>

## Panels and areas

Panels sit in three areas around the editor groups: **left**, **right** and **bottom**. The problems panel opens in the bottom area. The **local queue** panel, which renders briefs that other programs drop into a folder, opens in the left area and starts closed: open it with **Show the local queue** in the command bar or the queue button in the status bar. The buttons at the two ends of the status bar show and hide whole areas, and **Restore the default layout** puts every panel back.

The window remembers where you left the panels and which files were open, and gives them back the next time it opens.

## Language and colours

The window speaks the computer's language — English or Brazilian Portuguese — and **Switch the window language** in the command bar changes it. Its colour theme follows the computer's light or dark setting until you choose one with **Preferences: Color Theme**; the [Themes](../reference/themes.md) list shows them all.
