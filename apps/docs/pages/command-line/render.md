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

## Deliver into a folder of its own

`--folder` puts the files in a subfolder named after the brief, with the brief, `result.json` and `template.txt` in `editaveis/` beside them — the same layout the window's export writes:

```
deliveries/
  carousel/
    grid-01.png
    grid-02.png
    …
    editaveis/
      carousel.brief
      result.json
      template.txt
```

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

`--trust` trusts the folder for that one run and writes nothing down. `tyto trust remove <folder>` takes back a trust given earlier; the folders you trust are listed in `trust.json` in your Tyto home folder (`~/.tyto`).

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

The Reference's [`tyto render`](../reference/command-line.md#tyto-render) lists every option with its default.
