# Render a brief

::: info How this page was checked
Every command was run on 2026-10-19 on a build of the repository at commit `b039537` (CLI 0.4.1) on Windows 11, in a folder holding `formats.yaml`, a `templates/notice` folder and the manual's `carousel.brief`. The outputs below are copied from those runs.
:::

`tyto render` turns one brief into files in a folder — the same files [Export](../export/) makes in the window.

```
$ tyto render carousel.brief --out out
grid-01.png
story-01.png
grid-02.png
story-02.png
grid-03.png
story-03.png
grid-04.png
story-04.png
```

It prints each file as it is written. `out/` then holds the eight images and a `result.json` listing them. `--out` is required, unless the brief is in a workspace folder whose project file names an output folder (below).

## Choose the file types, scale and quality

`--types` takes one or more of `png`, `jpeg`, `webp` and `svg`, separated by commas; PNG alone if you leave it out. `--scale 2` doubles the pixels of the images, and `--quality` (1 to 100) reaches JPEG and WebP only, as in the window — see [Images](../export/images.md).

```
$ tyto render carousel.brief --out out2 --types svg,webp --scale 2 --quality 80
grid-01.svg
grid-01.webp
story-01.svg
story-01.webp
```

(The first four lines of sixteen.)

## Write into a folder of its own

`--folder` puts the files in a subfolder named after the brief, with nothing beside them — no `result.json`, no copy of the brief, no images — as the window's export does. The run's report is what the command prints, and `--json` prints it as one document:

```
deliveries/
  carousel/
    grid-01.png
    grid-02.png
    …
```

A file already there with the same name is replaced, and every other file is left as it is.

## Render inside a workspace folder

A workspace folder is a project folder with a `.tyto/project.json` in it. The file says where the project keeps its templates, images and fonts, and where its exports go:

```jsonc
{
  // where this project keeps its things
  "templates": ["tpl"],
  "assets": ["art"],
  "output": "exports",
}
```

`tyto render` looks for that file in the brief's folder and in each folder above it, so a brief anywhere inside the project uses it with nothing typed. The commands below were run on 2026-10-21 in such a folder, with the brief in `briefs/`, its template in `tpl/` and its image in `art/`:

```
$ tyto render briefs/cartaz.brief --types svg
feed-01.svg
feed-02.svg
```

The files went to `exports/`. An `--out` you type still wins, and so does `--templates`. Image paths are looked for beside the brief first, then in `assets/` beside it, then in the project's `assets` folders.

### A folder you have not trusted

Until you trust a workspace folder, every folder its project file names must be inside it. A name that leads outside — `../shared/exports`, an absolute path, or a link inside the folder that points elsewhere — is left out and printed:

```
$ tyto render briefs/cartaz.brief --types svg
.tyto\project.json:4:13: warning W_PROJECT_PATH_OUTSIDE Project key 'output' leads outside this folder ('../shared/exports'), which an untrusted folder may not do; it is left out.
error: --out is required: .tyto\project.json declares no output folder this run may use
```

`--trust` trusts the folder for that one run and writes nothing down. To trust it for good, run `tyto trust add <folder>`: it first prints what the folder does while it is not trusted, then writes the approval, with no question to answer, so a script can run it too. A folder without a `.tyto/project.json` can be trusted as well.

Run on 2026-10-22 in a folder whose project file names `../shared/exports` and `../team/saude.json` (the folder's path shortened to `D:\work\campanha`):

```
$ tyto trust add .
.tyto\project.json:3:13: warning W_PROJECT_PATH_OUTSIDE Project key 'output' leads outside this folder ('../shared/exports'), which an untrusted folder may not do; it is left out.
.tyto\project.json:4:14: warning W_PROJECT_PATH_OUTSIDE Project key 'profile' leads outside this folder ('../team/saude.json'), which an untrusted folder may not do; it is left out.
Above: what this folder does while restricted; trusting it lifts that.
Trusted: D:\work\campanha (since 2026-10-22)
It names the work profile D:\work\team\saude.json, which is trusted on its own (ADR 0114): tyto trust add "D:\work\team\saude.json"

$ tyto trust list
D:\work\campanha  since 2026-10-22
Take one back with tyto trust remove <path>.
```

`tyto trust list` prints every folder and profile file you trust, with the day you trusted it, and marks one that is no longer there with `(missing)`. `tyto trust remove <folder>` takes back a trust given earlier. Both read and write `trust.json` in your Tyto home folder (`~/.tyto`), the same file the desktop app writes when you trust a folder there. Your Tyto home folder itself cannot be trusted as a project: it holds your plugins and `trust.json`, not a project's content.

### Share one sheet across folders: work profiles

When many project folders keep their things in the same places — one vertical's templates, images, fonts and output folder — write those places once in a **work profile** and let each folder name it. Keep the profile in your Tyto home folder, one folder per profile:

```jsonc
// ~/.tyto/profiles/saude/profile.json
{
  "templates": ["tpl"],
  "assets": ["art"],
  "output": "../../../exports",
}
```

A profile takes the same keys as a project file, and its relative folders are read from the profile's own folder, so `tpl` above is `~/.tyto/profiles/saude/tpl` for every project that uses it. A project file names the profile and writes only what differs:

```jsonc
// campanha-a/.tyto/project.json
{ "profile": "saude" }
```

```jsonc
// campanha-b/.tyto/project.json
{
  "profile": "saude",
  "output": "out",
}
```

Run on 2026-10-21, with no template or image in either folder:

```
$ tyto render briefs/cartaz.brief --types svg
feed-01.svg
feed-02.svg
```

From `campanha-a` the files went to the profile's `exports/`; from `campanha-b` they went to its own `out/`. A key the folder writes replaces the profile's whole — a folder that writes `fonts` uses those fonts and none of the profile's — and a key it leaves out comes from the profile.

A profile's name is a plain folder name: letters, digits, spaces and accents are fine, but not a slash, a leading dot or `..`. A name that is not in `~/.tyto/profiles/` is printed as `W_PROJECT_PROFILE_MISSING`, and the folder renders with its own keys.

**A profile shared by a team** is a file you name by its path instead, such as `"profile": "../team/saude.json"`, or a folder holding a `profile.json`. Because somebody else may edit it, it is trusted on its own, never because the folder that names it is: until you trust that file with `tyto trust add <file>`, its folders must stay inside its own folder, and `tyto trust remove <file>` takes its trust back. `tyto trust add <folder>` tells you which file to trust when the folder names one. A profile in `~/.tyto/profiles/` is already trusted, because of where it lives. A folder you have not trusted may only name a profile file inside itself:

```
$ tyto render briefs/cartaz.brief --types svg
.tyto\project.json:2:14: warning W_PROJECT_PATH_OUTSIDE Project key 'profile' leads outside this folder ('../team/saude.json'), which an untrusted folder may not do; it is left out.
```

`--trust` covers the folder and the profile it names, for that run only.

## When the brief has errors

Each problem is printed with the file, the line and the column, the code and what is wrong, and the command ends with exit code `1`:

```
$ tyto render broken.brief --out out3
broken.brief:1:1: error E_MISSING_REQUIRED_SLOT Template 'notice' requires slot 'titulo', which the brief does not set.
broken.brief:5:3: error E_UNKNOWN_SLOT Unknown slot 'subtitle'. Template 'notice' declares: titulo, subtitulo, imagem, tom, lamina.
    Did you mean 'subtitulo'?
grid-01.png
```

What could still be drawn is written, as `grid-01.png` was here, so check the exit code rather than whether files appeared. With `--json` the same run prints `"status": "error"` and each problem with its `code`, `line` and `column`.

## Other options

- `--template` says which template to use for a brief whose frontmatter names none; a brief that names one wins.
- `--formats` says which sizes to make. For a brief with a `formats:` line it picks some of the sizes on that line; a size the line does not have is `E_FORMAT_NOT_IN_BRIEF`. For a brief without the line it is the list of sizes.
- `--assets` says where image paths in the brief are looked for; by default an `assets/` folder beside the brief, else the brief's own folder.
- `--section <plugin>.<key>=<value>` sets one key of a plugin's own key under `plugins` in `.tyto/project.json` for this run, over what the file says, and leaves the file alone. Repeat it for more keys. The value is read as JSON when it is JSON — `50`, `true`, `["a","b"]` — and as the text you typed otherwise; write `'"42"'` for the text `42`. It counts in an untrusted folder too, where the file's own plugin keys stay withheld: you typed it, so you approved it. A flag that is not `<plugin>.<key>=<value>` stops the run before it starts.

The Reference's [`tyto render`](../reference/command-line.md#tyto-render) lists every option with its default.
