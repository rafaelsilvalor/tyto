You drive the creation of one **Tyto template in its own repository**, from the first question
to Rafael until the template is installed, renders an example brief and is in the brief-modeller
skill. Production templates never go into `packages/templates` (ADR 0151); only test templates
live in Tyto's repository.

Talk to Rafael in pt-BR, in the plain, short style of his global `CLAUDE.md` ("Estilo Bancada",
lean mode). Everything you write in the new repository, in Tyto's repository and in Jira stays
in English, except the Portuguese half of a card.

## Arguments

- `$ARGUMENTS` = `<name>` → the template's name; step 1 starts at the second question.
- Empty → step 1 starts by asking the name.

## Read first

1. `docs/plugin-authoring.md` › _Develop it in its own repository_ and the three sections under
   it, and `docs/template-authoring.md` › _Previewing a template while you write it_.
2. ADRs 0149 (the contract on GitHub Packages), 0150 (`@tyto/plugin-api/testing`), 0151 (plugin
   files; a configuration changes a value, never the composition), 0152
   (`@tyto/template-kit/testing`) and 0153 (`values` in the manifest).
3. The worked example, `C:\projects\tyto\templates\tyto-template-tabela`: run
   `git -C C:/projects/tyto/templates/tyto-template-tabela pull --ff-only` first, then read its
   `README.md`, `package.json`, `tyto-plugin.json`, `src/`, `tests/`, `templates/` and
   `.github/workflows/`.
4. The memory index, and in full: `templates-own-repos-2026-10-27`, `projects-layout-on-ssd`,
   `build-templates-live-with-the-preview`, `brief-modeller-skill-package`,
   `brand-content-in-public-repo`, `svg-geometry-in-colour-out` and
   `italic-breaks-the-builtin-render`.

Paths: Tyto's main checkout is `C:\projects\tyto\tyto`; template repositories live in
`C:\projects\tyto\templates\tyto-template-<name>`. The CLI is
`node C:/projects/tyto/tyto/apps/cli/dist/index.js` (below, `tyto`).

## 1. Four questions, one at a time

Ask with `AskUserQuestion`, **one question per call**, and wait for each answer before the next.
Offer options when there are options.

1. **The name.** Kebab-case, Portuguese like the house's names (`tabela`, `agenda-semana`). It
   becomes the manifest's `name`, the plugin's `name` and the repository
   `tyto-template-<name>`. **Refuse a name already taken**, and say where it was found:
   - a template in the app: every `name:` in
     `git -C C:/projects/tyto/tyto show origin/main:packages/templates/templates/<folder>/manifest.yaml`
     for each folder that `git ls-tree --name-only origin/main packages/templates/templates/`
     lists (fetch first; a folder name and a manifest name can differ);
   - a template repository on disk: every folder under `C:\projects\tyto\templates`, and every
     `name:` in their `templates/*/manifest.yaml`;
   - a repository on GitHub: `gh repo view rafaelsilvalor/tyto-template-<name>` must fail.
2. **The artwork and its formats.** What the art is for, and the exact canvases (`1080×1350`,
   `1080×1920`…). The formats are exact: "no story" means no story. When a size he gives
   contradicts a reference he shows, ask before choosing.
3. **The brand kit or neutral.** With the house's kit, the template depends on
   `@tyto/house-style` and draws the logo and the signature that Tyto hands it from the brand kit
   installed on the machine (ADRs 0063, 0065), with placeholders when there is none. Neutral, it
   depends on no house package and declares its colours as `values`.
4. **Public or private.** Tyto's own repository is public. **Whatever he answers, no brand
   asset, logo, signature or real copy is ever committed to the template's repository**; the
   example briefs carry invented copy, as tabela's do.

## 2. The contract versions, read and confirmed

**Never write a version number into this command, the new repository's README or a card from
memory.** Read them from tabela's current `package.json`, which CI keeps building against the
published contract:

```sh
node -p "Object.entries(require('C:/projects/tyto/templates/tyto-template-tabela/package.json').devDependencies).filter(([name]) => name.startsWith('@tyto/')).map(([name, range]) => name + ' ' + range).join('\n')"
```

Then confirm each one exists on GitHub Packages. Use `users/...` without a leading slash, or
Git Bash rewrites the path:

```sh
gh api users/rafaelsilvalor/packages/npm/tyto-plugin-api/versions --jq '.[].name'
```

once per package (`tyto-plugin-api`, `tyto-template-kit`, `tyto-core`, and `tyto-house-style`
when the brand kit is used). Also read the newest published version of each, and say it when it
is ahead of tabela's range: Rafael decides whether the new template starts on the newer
contract. A range whose version is not published stops the command here. The manifest's
`engine` follows the `@tyto/plugin-api` range (ADR 0149 decision 5); copy the way tabela writes
it. A 401 means the token lacks `read:packages`: `gh auth refresh -s read:packages`, and press
Enter in the terminal tab after approving in the browser.

## 3. The card in E18

`git -C C:/Users/rafae/.claude/LOTES pull --rebase`, then read `_registro.md`.

- **The `template-repos` batch is active** (a row under _Coordenadoras ativas_): tell its
  coordinator with `mcp__ccd_session_mgmt__send_message` to its `session_id`, in one message:
  the template's name, artwork, formats, brand or neutral, public or private, the contract
  versions from step 2, and a request that it become a card of E18 (TYTO-429) with the label
  `batch-template-repos`. The coordinator creates the card; wait for its key and use it in
  every commit.
- **The batch is not active**: create the card yourself, as `CLAUDE.md` › _Language_ asks: an
  English title and body that say why the card exists, parent TYTO-429, then `---` and a
  Portuguese half that explains, for somebody who does not write code, what Rafael can make
  afterwards that he could not before and what still does not work. Re-read its status after
  creating it: a new card lands in To Do or Ready unpredictably. Never move it to Done.

## 4. The repository, only after Rafael's OK

Show him, in five lines or fewer, what is about to happen: the repository name and visibility,
the folder, the contract versions, the formats, and brand or neutral. **Ask once and wait for a
clear yes.** Creating a repository is outward-facing; "ok, mas…" with a correction is not a yes:
repeat the question with the correction applied.

On his yes:

```sh
gh repo create rafaelsilvalor/tyto-template-<name> --private --description "<one line>"
git clone https://github.com/rafaelsilvalor/tyto-template-<name>.git C:/projects/tyto/templates/tyto-template-<name>
```

(`--public` when he chose public.) Copy tabela's structure, not its template:

| Copy as it is, renaming `tabela`                                                                            | Write new                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml`, `.github/workflows/contract.yml`                                                | `src/template.ts`, `src/index.ts` (the `BUILDS` map with the new name)                                                  |
| `.npmrc` — **the scope line and its comment only**, never a token                                           | `templates/<name>/manifest.yaml`, `templates/<name>/examples/*.brief`                                                   |
| `.gitattributes`, `.gitignore` (plus a `*.psd` line), `.prettierrc.json`, `.prettierignore`                 | `templates/formats.yaml` — only the formats from step 1                                                                 |
| `eslint.config.js`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `pnpm-workspace.yaml`            | `README.md`, in tabela's order: install, permissions, what a configuration may change, development, the tests           |
| `package.json` (name, description; the `@tyto/*` ranges from step 2; drop `@tyto/house-style` when neutral) | `tyto-plugin.json` (`name`, `version` 0.1.0, `engine`; `permissions` only for what it measures, e.g. `font:CircularXX`) |

`contract.yml` installs `@latest` for every `@tyto/*` package the template depends on: remove
`@tyto/house-style` from it and from its version line when the template is neutral.

**The four tests are the same four as tabela's**, adapted, and none of them needs Tyto:

- `src/template.test.ts` — the composition's rules on the `Scene`: every text inside its box,
  the formats it declares, what it does at the limits of its slots.
- `tests/examples.test.ts` — each example brief through `compileTemplate`
  (`@tyto/template-kit/testing`), against HTML snapshots in `tests/__snapshots__/`.
- `tests/values.test.ts` — each declared value's default pinned to the constant the code falls
  back to, and one value set in a test found in the HTML (ADR 0153).
- `tests/plugin.test.ts` — the built `dist/index.js` through `testPlugin`
  (`@tyto/plugin-api/testing`), drawing the template across the isolation protocol.

Install with the token from the user-level `~/.npmrc`, never from the repository:

```sh
NODE_AUTH_TOKEN=$(gh auth token) pnpm install
```

Start with a composition that only draws the slots' text in the right boxes, then `pnpm build`
and `pnpm check` green, **`dist/` committed**, and push. CI must be green on that first commit
before any design work: `gh run list --repo rafaelsilvalor/tyto-template-<name> --limit 1`, then
`gh run view <id> --repo rafaelsilvalor/tyto-template-<name>`, pasted verbatim. Commits follow
Tyto's rules: Conventional Commit with the card key, subject of at most 72 characters, one `-m`
per paragraph, no trailers.

## 5. Build it live with Rafael, measuring on the PNG

Rafael corrects from the image, not from a description. Every iteration ends with a picture he
can see and a number you measured.

**First try the live preview.** In the main checkout, `.claude/launch.json` gets a
`template-preview` configuration running
`pnpm template:preview C:/projects/tyto/templates/tyto-template-<name>/templates/<name>
--formats-file C:/projects/tyto/templates/tyto-template-<name>/templates/formats.yaml` on port
4174, started with `preview_start`. After each save read `http://127.0.0.1:4174/api/state` and
the PNG under `/out/<generation>/`.

**It may not run this template's code.** The preview renders the folder it is given with
`--templates`, and a code template's `build` lives in the repository's `dist/index.js`, not in
the folder (read in `tools/template-preview/src/target.ts` and `tyto.ts`, not measured when this
command was written). When `/api/state` answers a diagnostic instead of an image, say so to
Rafael in one line and use this loop instead, with a `TYTO_HOME` of its own so the real one is
untouched until step 6:

```sh
cd C:/projects/tyto/templates/tyto-template-<name>
pnpm build
TYTO_HOME=<scratchpad>/tyto-home tyto plugin install . --yes
TYTO_HOME=<scratchpad>/tyto-home tyto render templates/<name>/examples/<example>.brief --formats-file templates/formats.yaml --out <scratchpad>/out --json
```

`result.json` must say `status: "ok"` with no `W_PLUGIN_SKIPPED`. Show him the PNG with
`SendUserFile` (`display: "render"`), every time, without being asked. If the preview did run
the code, tell Rafael: the preview gap in TYTO-463's "Not in this card" is then wrong and the
README and this command are corrected.

Rules for the loop:

- **Distances and centring are measured in the PNG's pixels** (PIL: first and last non-paper row
  or column between bands), never read by eye from his reference. Say each time that a number
  read from the reference may be a few pixels off. PIL's `getbbox` on an RGBA image reads only
  alpha: convert to RGB and diff against the paper colour.
- **Geometry goes into the code; colour, sizes and gaps are `values`** with defaults (ADR 0153),
  as long as changing one never changes which pieces appear or their order (ADR 0151 decision
  1). Hide-the-logo or two-columns is a second template or a brief-side choice.
- Faces: only Regular and Bold exist in Tyto's font package; italic breaks the render.
- An illustration is a PNG asset; an SVG with `<style>` loses its markup on the way.
- `pnpm check` and the snapshots move with the composition: update them on purpose, never to
  make a red go away.

## 5a. With a PSD, it is the answer key

Before the first iteration, look for the art in `C:\projects\tyto\references\<name>\` (one
folder per template, named after it). **No PSD there: skip this step**, and the reference is
whatever Rafael shows.

**The PSD never enters a repository**, nor does anything extracted from it — not the PSD, the
flattened PNG, the layer list or its copy. Everything extracted goes to the scratchpad. The
template's `.gitignore` carries `*.psd` as a second lock, and the example briefs keep invented
copy even when the PSD has the real one.

**psd-tools first.** `python -c "import psd_tools; print(psd_tools.__version__)"` — without
`-I`, which hides the user-level site-packages where it is installed. When it fails, ask
Rafael to install it (`pip install psd-tools`) and wait; do not continue without it.

Extract, into `<scratchpad>/psd/<name>/`:

- **`flat.png`** — `PSDImage.open(path).composite().convert('RGB')`, the whole canvas.
- **`layers.json`** — for every layer of `psd.descendants()`: `name`, `kind`, `is_visible()`
  and `bbox` (left, top, right, bottom in canvas pixels). For a `type` layer also `text` (lines
  break on `\r`) and, for each run of `engine_dict['StyleRun']['RunArray']`, its font, size,
  leading and colour. Write it with `encoding='utf-8', newline=''`.

Three traps, measured on `questao-estrategica.psd` when this step was written:

- **The size is in points before the layer's scale.** The pixel size is the run's `FontSize`
  times `transform[3]`, the layer's vertical scale: one title reads `25.66` and is drawn at
  86 px (`× 3.359`), with a bounding box 85 px tall. The same holds for `Leading`.
- **The font comes quoted** from `resource_dict['FontSet'][index]['Name']` (`'CircularXX-Black'`):
  strip the quotes. The PSD may use weights Tyto does not ship (Black, Medium, Light,
  ExtraBlack in that file); a weight Tyto lacks is a question for Rafael, never a silent
  substitute.
- **The canvas may not be a format.** That PSD is 4395 × 2800, a carousel of four slides side
  by side. Name the region of each slide in canvas pixels and the scale to the format from
  step 1, say both to Rafael, and confirm them before comparing.

Colours are `FillColor.Values`, `[alpha, r, g, b]` from 0 to 1: write them as hex. These
become the template's numbers and `values` defaults: positions and sizes from `bbox` and the
scaled sizes, colours from the runs. **They replace reading the reference by eye**, so the
"a few pixels off" warning of step 5 does not apply to a number taken from `layers.json`; say
which numbers came from it.

**Every iteration ends with the comparison**, beside the PNG of step 5. Crop the slide's region
from `flat.png`, scale it to the format with the factor you confirmed (state it; at 1:1 there
is none), and diff it against the render in RGB with `ImageChops.difference`. Report:

- the pixels that differ by more than a small threshold (say which), over the total
  (`12 345 of 1 458 000`), and the bounding box of the difference;
- a diff image (the difference amplified, or the two overlaid) sent with `SendUserFile`, so
  Rafael sees where, not only how much.

The copy differs between the brief and the PSD unless the example brief carries the same
words, which it may not (invented copy). Compare the layout with a scratch brief holding the
PSD's text, kept in the scratchpad, and say that is what the number measures.

## 6. Close: installed, rendering, and in the skill

1. **Released.** `pnpm check` green, `dist/` committed and equal to what `src/` builds (CI's
   `dist is what src builds to` step), CI green on `main`, pasted verbatim. Tag `v0.1.0` when
   Rafael accepts the art.
2. **Installed for real**, into his own `TYTO_HOME` this time:
   `tyto plugin install git+https://github.com/rafaelsilvalor/tyto-template-<name>.git`. A
   private repository installs through his own git credentials.
3. **An example brief renders.** Copy the formats into the project's `formats.yaml` (a pack
   brings templates, not formats), `tyto render` an example with `--json`, and paste the
   `status` and the diagnostics verbatim. `status: "ok"` and no `W_PLUGIN_SKIPPED` is done.
   Show him the PNG.
4. **The brief-modeller skill is updated** — his rule: every new template updates it, and a
   template card is not finished without it. In
   `C:\Users\rafae\.claude\INSTRUCOES\modelador-de-brief\`: a new
   `references/templates/<name>.md` (copy `_modelo.md`), the entry in
   `references/templates.json` and the line in `references/templates/indice.md`; run
   `scripts/check_brief.py` on the example brief; repackage the zip as the memory
   `brief-modeller-skill-package` says. Uploading it to claude.ai replaces the skill on his
   account: ask before uploading.
5. **The card** goes to Review with the repository's link, never to Done. Tell the template-repos
   coordinator, when active, in one line.
6. **Report** in Estilo Bancada: what exists now (repository, tag, install, the rendered example),
   the `gh run view` output, the last comparison with the PSD when there was one (pixels over
   total), and the "O que ficou" table — whatever was not measured, the
   preview's answer from step 5, and what the art still lacks in his eyes.

## Rules that come from past mistakes

- **Never claim what you did not measure.** Say "read in the code" when that is what it was.
- "Espere" means stop: do not start the next action.
- Python writing a file: `newline=''`, or a brief gets CRLF and the parser refuses it. Python
  wants Windows paths (`C:/…`), not `/c/…`.
- The repository's `.npmrc` never holds a token: pnpm 11 expands no variable in a committed
  `.npmrc`'s credentials, and a public repository would publish it.
- Do not edit Tyto's repository for the template. If the template needs something from the
  contract that does not exist, stop, say so, and it becomes a card in E18.
