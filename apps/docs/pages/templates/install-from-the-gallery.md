# Install from the gallery

The gallery is a list of templates and plugins somebody curates, each kept in a repository of its own. Tyto shows it, installs an entry with a click, and **never updates one by itself**: when a newer version comes out, the gallery says so and waits for you.

## Open it

Run **Gallery: Browse Templates and Plugins** from the command bar, or **Tools ▸ Gallery: Browse Templates and Plugins**. Each card shows a preview, the name, what it is, its version and its state:

- **Install**: no plugin file of yours holds it yet.
- **Installed at v1.2.0**: it is in your plugin files at that version.
- **Update to v1.3.0**: your plugin files pin an older version. The card says which, and what the new one changes.
- **Needs a newer Tyto**: the entry needs a newer plugin API than this Tyto has. It is listed and cannot be installed.

The buttons along the top show all the entries, only templates, only plugins, the installed ones or the ones with an update, each with how many there are.

## Install and update

**Install** writes the entry into your machine's plugin files (`<TYTO_HOME>/plugin-files/`), pinned to the version the gallery lists, then fetches it as **Plugins: Sync Plugin Files** does. A plugin that asks for permissions asks in the same box. A template is in the template list as soon as the fetch finishes, with no restart.

**Update** moves the version in the file that holds the entry, and nothing else, then fetches it. It is the only thing that moves a version: opening the gallery, rendering and syncing never do.

An entry you wrote into a plugin file yourself counts as installed. Update moves it too, and says which file it changed. If you changed a version the gallery wrote, Update refuses and says what it wrote and what it found; to move it anyway, run `tyto gallery update <id> --force` in a terminal.

What went wrong in a fetch is in the Problems panel, as for any plugin file.

## Which list it reads

The `galleryIndex` [setting](../reference/settings.md#galleryindex) names the list: a git repository holding an `index.yaml`. By default it is the one the Tyto project curates. Point it at another repository, a private one included, as long as your `git` can read it.

The list is fetched every time the gallery opens. Offline, the gallery shows the copy fetched last, previews included, and says when that copy is from. A list never fetched shows nothing.

From the command line, `tyto gallery list`, `tyto gallery install <id>` and `tyto gallery update <id>` do the same, with `--index` or `TYTO_GALLERY_INDEX` instead of the setting.
