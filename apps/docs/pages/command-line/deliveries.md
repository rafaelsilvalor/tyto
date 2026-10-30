# Deliveries

::: info How this page was checked
Every command was run on 2026-10-30 on a development build of the branch that added it (TYTO-489) on Windows 11, in a workspace folder whose `.tyto/project.json` was `{ "delivery": { "parent": "entregas" } }`. The outputs below are copied from those runs.
:::

A **delivery** is one folder per piece of work, named after its ticket: the brief, its images and, later, the finished artwork, kept together inside the project. `tyto delivery new` makes one; in the window, **File ▸ Delivery: New…** does ([Workspace folder](../editor/workspace-folder.md#deliveries-one-folder-per-piece-of-work)).

## Make a delivery

Run it from anywhere inside the workspace folder, with the name the folder will have:

```
$ tyto delivery new mca-66910_simule-sua-nota-da-2ª-fase
entregas\mca-66910_simule-sua-nota-da-2ª-fase\editaveis\mca-66910_simule-sua-nota-da-2ª-fase.brief
```

It makes the folder, `assets/` and `editaveis/` inside it, and an empty brief named after the delivery in `editaveis/`. The line it prints is the brief's path, alone, so a script can open it. Images you put in `assets/` are found by the brief, because a brief in `editaveis/` reads `../assets`.

Outside any workspace folder the delivery is made in the folder you are in, with the same layout.

## Start the brief from a template

`--template` (or `-t`) writes the template's skeleton into the brief instead of leaving it empty: the same text **New brief from template…** writes in the window, with the template's required slots and its sizes.

```
$ tyto delivery new mca-66911_aprovados -t aprovados
entregas\mca-66911_aprovados\editaveis\mca-66911_aprovados.brief
```

The name can be a template, or an alias a [plugin file](./plugins.md#configurations-and-aliases) defines; a configuration's own skeleton is used when it has one. In a folder you have not trusted, the plugin files the folder brings are not loaded; `--trust` trusts the folder and its work profile for this run only, as on `tyto render`.

## A folder that is already there

A delivery folder that already exists is **used as it is**: the folders it lacks are made and what is in it stays. You can make the folder by hand, or drop the images in first, and run the command afterwards.

A brief that is already there is **never overwritten**. The command stops, writes nothing — not even a missing folder — and exits with 1:

```
$ tyto delivery new mca-66910_simule-sua-nota-da-2ª-fase
error E_DELIVERY_BRIEF_EXISTS 'entregas\mca-66910_simule-sua-nota-da-2ª-fase\editaveis\mca-66910_simule-sua-nota-da-2ª-fase.brief' already exists, and a delivery's brief is never overwritten; nothing is written.
```

A delivery always stays inside the workspace folder. One that a shortcut inside the folder would carry outside it is refused with `E_DELIVERY_PATH_OUTSIDE`, and nothing is written.

## Which names work

The name becomes one folder's name, so it is refused, never changed, when a folder could not have it: empty, starting with a dot, holding `..`, `/`, `\` or one of `< > : " | ? *`, ending in a space or a dot, or a name Windows reserves such as `CON`. It can be up to 100 characters long, and any other letter is fine, `ª` and accents included.

```
$ tyto delivery new "mca:1"
warning W_DELIVERY_NAME_INVALID The delivery name 'mca:1' holds a character a folder name may not; no delivery is made.
```

## Change the layout

Where deliveries are made, which folders each one gets and where its brief is kept are set by the `delivery` key of the project file or of a work profile; [Workspace folder](../editor/workspace-folder.md#deliveries-one-folder-per-piece-of-work) describes it.
