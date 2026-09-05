# Tyto

_English · [Português abaixo](#português)_

Local-first, multi-format advertising art generator. Part of the Breu suite.

A **brief** written in a custom markup language picks a **template**, fills its slots, and is compiled into a **scene tree (IR)**. Independent exporters read the scene: HTML (rasterized in Chromium to PNG/JPG/WebP) and vector SVG. One piece can produce several artworks (carousel) in several formats (feed, story, banner).

Interfaces: desktop app (Electron; editor with syntax highlighting and vim mode) and a CLI. Remote queues and delivery (Jira, Drive…) belong to Jacurutu, a sibling product; the boundary is a file contract (ADR 0011). Everything that is a source, sink, exporter, rasterizer, template pack or editor command is a **plugin** — built-ins use the same API.

Start with `CLAUDE.md`, then `docs/architecture.md` and `docs/backlog.md`.

```
docs/
  architecture.md        pipeline, packages, boundaries, patterns
  ir-schema.md           scene tree schema
  brief-language.md      brief syntax (directives + frontmatter)
  template-authoring.md  how to write templates (human or AI agent)
  plugin-api.md          extension points and host API
  integrations.md        Jacurutu boundary, local inbox/outbox, deferred remote sources
  conventions.md         stack, tooling, tests
  git-workflow.md        branches, PRs, releases, GitHub workflows
  backlog.md             ordered epics and stories → Jira cards
  adr/                   architecture decision records
```

Language policy: code, comments, docs, commits and Jira cards are in English (cards also carry a Portuguese translation). The maintainer reads English and writes to AI agents in Portuguese.

---

## Português

Gerador multiformato de arte publicitária, local-first, parte da suíte Breu.

Um **brief** escrito em linguagem de marcação própria escolhe um **template**, preenche seus slots e é compilado para uma **árvore de cena (IR)**. Da cena saem exportadores independentes: HTML (rasterizado em Chromium para PNG/JPG/WebP) e SVG vetorial. Uma peça pode gerar várias artes (carrossel) em vários formatos (feed, story, banner).

Interfaces: app desktop (Electron; editor com highlight e modo vim) e CLI. Fila remota e entrega (Jira, Drive…) são papel do Jacurutu, outro produto da suíte; a fronteira é um contrato de arquivos (ADR 0011). Tudo que é fonte, destino, exportador, rasterizador, pacote de templates ou comando de editor é um **plugin** — os built-in usam a mesma API.

Comece por `CLAUDE.md`, depois `docs/architecture.md` e `docs/backlog.md`. A documentação técnica está em inglês; a explicação dos padrões para não-programadores está em `docs/patterns-explained.pt-BR.html`.
