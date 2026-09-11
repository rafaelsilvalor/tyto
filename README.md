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

Language policy: code, comments, docs, commits and Jira cards are in English. A card also carries a Portuguese half, which is **not** a translation — the maintainer reads English fine, so translating the body twice buys nothing. It says what the card adds for somebody who does not write code: one concrete thing a person can do afterwards that they could not do before, and one sentence on what still does not work. The maintainer reads English and writes to AI agents in Portuguese.

The `## Português` section below follows the same rule, for the same reason.

---

## Português

O Tyto monta arte publicitária a partir de um arquivo de texto, na sua própria máquina.
Faz parte da suíte Breu.

**O que você escreve.** Um arquivo — o _briefing_ — com o texto da peça, as imagens e as
opções que ela aceita. Não é editor de imagem: você não arrasta caixa, não escolhe posição,
não mexe em tamanho. Quem sabe onde cada coisa fica é o _template_, que alguém de design
escreve uma vez e todo mundo reusa.

**O que sai.** As artes prontas, em todos os tamanhos que a campanha pede — feed, story,
banner — do mesmo briefing e de uma vez só. Um carrossel de cinco slides vira cinco artes em
cada tamanho. Saem em PNG, JPEG e WebP, e também em SVG.

**Por que isso resolve algo.** Mudou o preço, mudou a data, mudou uma palavra: você edita uma
linha e gera tudo de novo em segundos, sem refazer doze arquivos à mão. E o mesmo briefing
sempre produz as mesmas imagens — não "parecidas", idênticas. É isso que permite mandar
gerar sem ter que conferir peça por peça.

**O que ainda não funciona.** Não existe janela: hoje só roda por linha de comando, e o
aplicativo de desktop ainda está por fazer. **Texto ainda não é desenhado** — o projeto
ainda não embarcou nenhuma fonte, então uma peça com palavras não renderiza. O SVG que sai
ainda não abre direito em Illustrator ou Figma. E não há integração com Jira ou Drive: isso é
papel do Jacurutu, o outro produto da suíte.

Para quem for mexer no código: comece por `CLAUDE.md`, depois `docs/architecture.md` e
`docs/backlog.md`. A documentação técnica está em inglês; a explicação dos padrões de projeto
para não-programadores está em `docs/patterns-explained.pt-BR.html`.
