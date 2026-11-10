# 0186 — A template's own guide and examples teach an agent to write its brief

Status: accepted · 2026-11-10 · TYTO-565 · builds on ADR 0179 and ADR 0185; adds a row to ADR
0111's table

## Context

TYTO-565 asks `tyto mcp` to give an agent "the knowledge of the brief-modeller skill (how to
shape raw copy into a brief for each template), served from the templates' own data, not from
company text in core". Today that knowledge lives outside Tyto, in a skill the maintainer keeps:
per template, which line of the copy goes in which slot, how a list is split into slides, and the
mistakes already made. With it an agent wrote briefs that rendered; without it, few did.

Read in the code and on disk on 2026-11-10: every template folder has a `manifest.yaml`, and the
test pack and every production template repository also ship an `examples/` folder of briefs,
which `tyto template new` writes too. A template pack's `package.json` ships its whole
`templates/` folder, so a file beside the manifest reaches an installed copy. `TemplateRegistry`
answers `directoryOf(name)`. What no template folder has is the prose: the manifest says what a
slot is, not how a person's copy maps onto it.

Two things had to be settled: where that prose lives, and who may put it in front of an agent.
The second matters because a guide is not like the rest of a template folder. A slot or an image
is data Tyto draws. A guide is text written **for an agent to follow**, so it can instruct one,
and a project folder is text anybody could have written (ADR 0179 decision 3).

## Decision

1. **A template's guide is an optional `guide.md` beside its `manifest.yaml`.** Plain Markdown in
   the author's words, read as data and never run. There is no manifest key and no schema
   change: a template without one loads, checks and renders as before, and `tyto template check`
   does not read it. Tyto adds no text of its own to a guide, and keeps no company, brand or
   vertical vocabulary in code: what a piece is called and how its copy is split is the template
   author's, in the template's repository.

2. **The guide and the example briefs are MCP resources.** `tyto://template/<name>/guide`
   (`text/markdown`) and `tyto://template/<name>/examples/<file>` (`examples/*.brief`, in file
   name order). Both are listed per template, so an agent's host can show them. They are capped
   so that one resource cannot fill an agent's context: **64 KiB per guide, 16 KiB per example,
   eight examples per template**. A cut falls on a character boundary and ends with a line that
   says how many bytes were shown; the examples past eight are counted, not listed.

3. **The `model_brief` prompt puts them in front of the copy.** Its arguments are `copy` and an
   optional `template`. With a template, it answers one message: generic steps in Tyto's own
   tools (keep the copy's words, fill only declared slots within their limits, `check_brief`
   until clean, `render_preview` and look, `write_brief` with a dry run only when asked), then the
   template's description, its formats, slots and adjustments as `describe_template` answers
   them, its skeleton, its guide, its examples, and the copy, each in a fence the text inside
   cannot close. Without one, it lists the templates with their descriptions and says to choose.
   The steps are the only text the prompt adds, and they name tools, not pieces.

4. **A guide and examples are read inside their template's folder, links followed.** Each file is
   followed to its real path, and one outside the template's own folder is read as no file. A
   pack therefore cannot hand an agent a file from elsewhere on the disk through a link.

5. **New rule: a restricted folder's own template serves no guide and no examples.** When the
   workspace is restricted, or there is none, a template whose folder lies inside the served
   folders, the folder's `templates/` or a template folder its project sheet names is answered
   with a sentence saying why, and its resources are neither listed nor read; the prompt shows the
   sentence in their place. The template itself still lists, describes, checks and renders, as
   ADR 0111 lets a restricted folder do. The built-in pack and installed plugins' packs keep their
   guidance: the person installed those. A pack fetched through a restricted folder's plugin files
   is not loaded at all (ADR 0179 decision 3), so it has none to serve. **ADR 0111's table gains
   a row:** _a template's guide and example briefs, served to an agent — gated_.

6. **Resources and prompts are reads, not tools.** They change nothing and are served by stdio
   and by the window's endpoint alike (ADR 0180), so they do not enter `MCP_TOOLS`; the trust
   rule of decision 5 decides per template what they contain, not whether they exist. A refusal
   on a resource read travels as the request's error, since a resource read has no `isError`.

## Consequences

- The knowledge the skill holds moves into each template's repository as its `guide.md`, beside
  the examples it already ships, and versions with the template. Until a template has one, the
  prompt says so and the agent goes by slots and examples.
- An example brief is served exactly as written; one that no longer checks teaches the agent a
  mistake. The template's own tests are where that is caught, not this server.
- A guide is text an agent follows. In a trusted folder, or from an installed pack, Tyto serves it
  as the person installed or trusted it; the agent's host still decides what a tool call does.
- Listing resources reads each template's folder on every call, as `list_templates` reads the
  registry: an agent that edits a guide sees the edit at once.
