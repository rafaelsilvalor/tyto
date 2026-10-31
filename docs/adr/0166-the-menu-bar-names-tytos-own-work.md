# 0166 — The menu bar names Tyto's own work

Status: accepted · 2026-10-31 · TYTO-514 · beside ADR 0078, ADR 0080 and ADR 0099

## Context

The application menu began as a defence. Electron's default menu carries `CommandOrControl+W` on
Close Window and `CommandOrControl+R` on Reload, and a menu accelerator fires in the browser
process before the page sees the key, so the default menu closed the window and threw away every
open tab (TYTO-104). `src/main/menu.ts` said it existed "for one reason": to keep those two keys
away from the page. TYTO-124 then gave it a File menu written out of command ids, TYTO-264 gave
the titles this app's words and mnemonics (ADR 0078), and every later card that wanted a click
put its command in File.

By 2026-10-31 File held 19 items: new and open, export, the templates, the gallery, the plugins,
the queue, settings, keybindings and snippets. Over fifteen registered commands had no item at
all — the preview's slides, formats, zoom and lock, Format Brief, the "/" menu, Delivery: Export,
a new terminal, the Commands panel, the vim mode, Manage Trust — and could be reached only by a
key or the command bar. Rafael chose on 2026-10-31 that the menus should show the app's most
relevant functions, named after them (option B).

## Decision

1. **The menu bar teaches what Tyto does.** It is the place a person who has learnt no key finds
   every verb the app has worth a click. Keeping destructive accelerators away from the page is
   still its rule, and it still holds — no item carries an accelerator — but it is no longer its
   only reason.
2. **Seven menus, in this order: File · Edit · Brief · Preview · View · Tools · Help.** Window
   stays where it was, between Tools and Help, on every platform; macOS keeps its application
   menu first. Brief, Preview and Tools are this app's own top-level items: each has an id
   (`brief`, `preview`, `tools`) the drawn menu row asks for it by, as `file` has, and a title
   from the catalogue with a mnemonic off macOS (`&Brief`, `&Preview`, `&Tools`; `&Brief`,
   `&Prévia`, `&Ferramentas`).
   - **File** — make, open, keep and put away a file or a folder: new brief, new from template,
     new delivery, open, open folder, open recent; save, save as; close, close folder; Exit or
     Quit.
   - **Edit** — the clipboard roles, unchanged.
   - **Brief** — what is done to the brief in front: format, insert ("/" menu), go to block;
     export, export the delivery; edit template, new template.
   - **Preview** — open, open to the side, lock; next and previous slide, all slides, one slide;
     next and previous format; zoom to fit, in, out.
   - **View** — the editor groups; the bottom area's Problems, Commands and Terminal tabs; the
     vim mode; reload and the developer tools; the window zoom; full screen.
   - **Tools** — the gallery, the plugins, the queue; a new terminal; settings, keybindings,
     snippets; the folder's trust.
   - **Help** — the manual, the log folder, About, unchanged.
3. **Every item is a registry command.** The tables live in `shared/commands.ts`; each item's
   click is `onCommand(id)`, the same `registry.run` the command bar calls, and its label is the
   command's own catalogue key, so an item and a command-bar row read the same. The menu has no
   second code path. A command a menu needs and the registry lacks gets an id there first:
   `problems.show` and `terminal.show` were added for View, and they bring their tab to the front
   rather than toggling it, for the reason `queue.show` gives (an item that hid its tab on the
   second click would lie). The Commands tab is `commandPanel.run`, which already opens it.
   `MENU_COMMANDS` lists every id any menu offers; a unit test holds each one to a registered,
   labelled command, and the window greys the ones that do nothing with the tab in front.
4. **No accelerators, and no key printed beside an item.** The keys stay the page's (TYTO-124,
   TYTO-286). A key shown as text would have to be read from the keymap in force — the person's
   `keybindings.json`, vim or not — which lives in the renderer; written by hand it would lie the
   first time somebody rebinds it. So none is shown until the window can send its keymap's text
   to main.
5. **Where a new command goes.** Ask what it acts on:
   - a file or a folder as a whole, opened, saved or closed → **File**;
   - the brief in front, or what it is written against or exported to → **Brief**;
   - the preview in front → **Preview**;
   - how the window is arranged or shown → **View**;
   - the app and its surroundings: what can be installed, what runs, the person's own files,
     trust → **Tools**;
   - the manual, the log, the version → **Help**.

   A command that is only a step inside another (a recent file, a tab's slot, an export preset)
   stays in the command bar. A menu that grows past about fifteen items is split before a sixth
   group is added.

## Consequences

- A person who opens the app sees Brief, Preview and Tools and reaches by a click what was a key
  or a typed command: format the brief, step through the preview's slides, open a terminal or
  the gallery.
- File is short again and says what it holds. Export and the template verbs moved to Brief, the
  screens about the app to Tools; a person used to File ▸ Export finds it one menu along.
- The drawn menu row on Windows and Linux shows eight titles instead of five.
- Keys are not shown beside items. Showing them, read from the keymap in force, is a follow-up.
