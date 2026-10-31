---
name: new-template
description: Drive the creation of one Tyto template in its own repository, from the first question to the maintainer until it is installed, renders an example brief and is in the brief-modeller skill. Use when the maintainer asks for a new template ("novo template", "criar o template X"). Do not use to edit a template that already exists, or for test templates inside Tyto's repository.
---

# New template

Codex port of `.claude/commands/new-template.md`. The steps and rules are the same; the
Claude Code tools it names are replaced by what Codex has. Keep the two files in step.

Production templates never go into `packages/templates` (ADR 0151); only test templates live
in Tyto's repository.

Talk to the maintainer in pt-BR, in the plain, short style his home instructions set.
Everything you write in the new repository, in Tyto's repository and in Jira stays in English,
except the Portuguese half of a card.

**Paths.** The folders below are named, not spelled out, because this file is public. The
maintainer's home `AGENTS.md` gives each one: `<tyto>` (Tyto's main checkout), `<templates>`
(where template repositories are cloned), `<references>` (one folder of artwork per template),
`<brief-modeller>` (the brief-modeller skill's source folder) and `<batches>` (the private
batch repository). The CLI is `node <tyto>/apps/cli/dist/index.js` (below, `tyto`).

## Read first

1. `docs/plugin-authoring.md` › _Develop it in its own repository_ and the three sections under
   it, and `docs/template-authoring.md` › _Previewing a template while you write it_.
2. ADRs 0149, 0150, 0151, 0152 and 0153.
3. The worked example, `<templates>/tyto-template-tabela`: `git -C <that folder> pull
--ff-only` first, then read its `README.md`, `package.json`, `tyto-plugin.json`, `src/`,
   `tests/`, `templates/` and `.github/workflows/`.
4. The home agent notes on templates in their own repositories, the brief-modeller package,
   brand content in the public repo, geometry-in-code / colour-in-values, and italics.

## 1. Four questions, one at a time

Ask in chat, **one question per message**, and wait for each answer before the next. Offer
options when there are options.

1. **The name.** Kebab-case, Portuguese like the house's names (`tabela`, `agenda-semana`). It
   becomes the manifest's `name`, the plugin's `name` and the repository
   `tyto-template-<name>`. **Refuse a name already taken**, and say where it was found:
   - a template in the app: every `name:` in
     `git -C <tyto> show origin/main:packages/templates/templates/<folder>/manifest.yaml` for
     each folder `git -C <tyto> ls-tree --name-only origin/main packages/templates/templates/`
     lists (fetch first; a folder name and a manifest name can differ);
   - a template repository on disk: every folder under `<templates>`, and every `name:` in
     their `templates/*/manifest.yaml`;
   - a repository on GitHub: `gh repo view rafaelsilvalor/tyto-template-<name>` must fail.
2. **The artwork and its formats.** What the art is for, and the exact canvases (`1080×1350`,
   `1080×1920`…). "No story" means no story. When a size he gives contradicts a reference he
   shows, ask before choosing.
3. **The brand kit or neutral.** With the house's kit, the template depends on
   `@tyto/house-style` and draws the logo and the signature from the brand kit installed on the
   machine (ADRs 0063, 0065), with placeholders when there is none. Neutral, it depends on no
   house package and declares its colours as `values`.
4. **Public or private.** **Whatever he answers, no brand asset, logo, signature or real copy
   is ever committed to the template's repository**; the example briefs carry invented copy.

## 2. The contract versions, read and confirmed

**Never write a version number from memory.** Read them from tabela's current `package.json`:

```sh
node -p "Object.entries(require('<templates>/tyto-template-tabela/package.json').devDependencies).filter(([name]) => name.startsWith('@tyto/')).map(([name, range]) => name + ' ' + range).join('\n')"
```

Then confirm each exists on GitHub Packages (no leading slash, or Git Bash rewrites the path):

```sh
gh api users/rafaelsilvalor/packages/npm/tyto-plugin-api/versions --jq '.[].name'
```

once per package (`tyto-plugin-api`, `tyto-template-kit`, `tyto-core`, and `tyto-house-style`
with the brand kit). Say the newest published version of each when it is ahead of tabela's
range: the maintainer decides whether the new template starts on it. A range whose version is
not published stops here. The manifest's `engine` follows the `@tyto/plugin-api` range (ADR
0149 decision 5). A 401 means the token lacks `read:packages`: `gh auth refresh -s
read:packages`, and the maintainer approves it in the browser.

## 3. The card in E18

`git -C <batches> pull --rebase`, then read `_registro.md`.

- **The `template-repos` batch is active**: its coordinator creates the card. A Codex
  coordinator is reached with `codex exec resume <thread id>`; a Claude Code coordinator
  cannot be messaged from Codex, so append the request to `<batches>/template-repos.md`
  under a dated line, push it, and tell the maintainer to point the coordinator at it. Send
  the name, artwork, formats, brand or neutral, public or private, the contract versions, and
  ask for a card of E18 (TYTO-429) with the label `batch-template-repos`. Wait for its key.
- **The batch is not active**: create the card yourself, as `AGENTS.md` › _Language_ asks,
  parent TYTO-429. Re-read its status after creating it. Never move it to Done.

## 4. The repository, only after the maintainer's OK

Show him, in five lines or fewer: repository name and visibility, folder, contract versions,
formats, brand or neutral. **Ask once and wait for a clear yes.** "ok, mas…" with a correction
is not a yes: repeat the question with the correction applied.

On his yes:

```sh
gh repo create rafaelsilvalor/tyto-template-<name> --private --description "<one line>"
git clone https://github.com/rafaelsilvalor/tyto-template-<name>.git <templates>/tyto-template-<name>
```

(`--public` when he chose public.) Copy tabela's structure, not its template: the workflows
(`ci.yml`, `contract.yml`), `.npmrc` (**the scope line and its comment only, never a token**),
`.gitattributes`, `.gitignore` plus a `*.psd` line, Prettier, ESLint, TypeScript, tsup, Vitest
and workspace configs, `package.json` with the ranges from step 2 (drop `@tyto/house-style`
when neutral, in `contract.yml` too). Write new: `src/template.ts`, `src/index.ts`, the
manifest, the example briefs, `templates/formats.yaml` with only the step-1 formats, the
README in tabela's order, and `tyto-plugin.json` (`version` 0.1.0, `engine`, `permissions`
only for what it measures).

**Five tests**, none needing Tyto: `src/template.test.ts` (composition rules on the `Scene`),
`tests/examples.test.ts` (examples through `compileTemplate`, HTML snapshots),
`tests/values.test.ts` (ADR 0153), `tests/plugin.test.ts` (`testPlugin` on the built
`dist/index.js`) and `tests/faces.test.ts` (copied from `tyto-template-agenda-semana`).

Install with the token from the user-level `~/.npmrc`, never from the repository:
`NODE_AUTH_TOKEN=$(gh auth token) pnpm install`.

Start with a composition that only draws the slots' text in the right boxes, then `pnpm build`
and `pnpm check` green, **`dist/` committed**, and push. CI green on that first commit before
any design work: `gh run list --repo rafaelsilvalor/tyto-template-<name> --limit 1`, then `gh
run view <id>`, pasted verbatim. Commits follow Tyto's rules (`AGENTS.md`).

## 5. Build it live with the maintainer, measuring on the PNG

He corrects from the image, not from a description. Every iteration ends with a picture he can
see and a number you measured.

Run the live preview as a long-running shell process:
`pnpm -C <tyto> template:preview <templates>/tyto-template-<name>` (port 4174). The template
repository needs its `pnpm install` first. It installs the build into a `TYTO_HOME` of its own;
the real one is never written, and the committed `dist/` is never rewritten, so `pnpm build`
before committing.

After each save read `http://127.0.0.1:4174/api/state` and the PNG under `/out/<generation>/`.
Show him the PNG every time, without being asked: save it under the thread's scratch folder
and give its full path (the Codex app opens a local image path). `status: "failed"` with
`PREVIEW_BUILD_FAILED` is esbuild's error; with `PREVIEW_INSTALL_FAILED`, what `tyto plugin
install` refused. `--brief <file>` picks another example.

- **Distances and centring are measured in the PNG's pixels** (PIL), never read by eye. PIL's
  `getbbox` on RGBA reads only alpha: convert to RGB and diff against the paper colour.
- **Geometry goes into the code; colour, sizes and gaps are `values`** (ADR 0153), as long as
  changing one never changes which pieces appear or their order (ADR 0151).
- Faces: only Regular and Bold exist in Tyto's font package; italic breaks the render.
- An illustration is a PNG asset; an SVG with `<style>` loses its markup on the way.
- Update snapshots on purpose, never to make a red go away.

## 5a. With a PSD, it is the answer key

Look for the art in `<references>/<name>/`. **No PSD there: skip this step.** **The PSD never
enters a repository**, nor does anything extracted from it; extracted files go to scratch.

`python -c "import psd_tools; print(psd_tools.__version__)"` (without `-I`, which hides the
user site-packages). When it fails, ask the maintainer to install it and wait.

Extract `flat.png` (`PSDImage.open(path).composite().convert('RGB')`) and `layers.json`
(`name`, `kind`, `is_visible()`, `bbox`; for type layers `text` and each style run's font,
size, leading and colour; written with `encoding='utf-8', newline=''`). Three traps: the size
is in points before the layer's scale (multiply by `transform[3]`, leading too); the font name
comes quoted (strip it; a weight Tyto lacks is a question, never a silent substitute); the
canvas may hold several slides (name each region and the scale, confirm before comparing).
Colours are `FillColor.Values` `[alpha, r, g, b]` from 0 to 1, written as hex.

Every iteration ends with the comparison: crop and scale the slide from `flat.png`, diff in RGB
with `ImageChops.difference`, report the pixels above a stated threshold over the total and the
bounding box, and give a diff image. Compare layout with a scratch brief holding the PSD's text.

## 6. Close: installed, rendering, and in the skill

1. **Released.** `pnpm check` green, `dist/` equal to what `src/` builds, CI green on `main`,
   pasted verbatim. Tag `v0.1.0` when the maintainer accepts the art.
2. **Installed for real**: `tyto plugin install git+https://github.com/rafaelsilvalor/tyto-template-<name>.git`.
3. **An example brief renders**: copy the formats into the project's `formats.yaml`, `tyto
render` an example with `--json`, paste `status` and the diagnostics verbatim. `status:
"ok"` and no `W_PLUGIN_SKIPPED` is done.
4. **The brief-modeller skill is updated**, every time: in `<brief-modeller>`, a new
   `references/templates/<name>.md` (copy `_modelo.md`), the entry in
   `references/templates.json` and the line in `references/templates/indice.md`; run
   `scripts/check_brief.py` on the example brief; repackage the zip as the home notes say.
   Uploading it to claude.ai replaces the maintainer's skill: ask first.
5. **The card** goes to Review with the repository's link, never to Done.
6. **Report** in his style: what exists now, the `gh run view` output, the last PSD comparison
   when there was one, and the "O que ficou" table.

## Rules that come from past mistakes

- **Never claim what you did not measure.** Say "read in the code" when that is what it was.
- "Espere" means stop: do not start the next action.
- Python writing a file: `newline=''`, or a brief gets CRLF and the parser refuses it. Python
  wants Windows paths (`C:/…`), not `/c/…`.
- The repository's `.npmrc` never holds a token.
- **A code template declares `faces:` in its manifest**, every face it measures (TYTO-436); a
  face left out measures as nothing, and only `tests/faces.test.ts` notices.
- Do not edit Tyto's repository for the template. If the contract lacks something, stop, say
  so, and it becomes a card in E18.
