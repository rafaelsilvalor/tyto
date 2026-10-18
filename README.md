# Tyto

_English · [Português abaixo](#português)_

Local-first, multi-format advertising art generator. Part of the Breu suite.

A **brief** written in a custom markup language picks a **template**, fills its slots, and is compiled into a **scene tree (IR)**. Independent exporters read the scene: HTML (rasterized in Chromium to PNG/JPG/WebP) and vector SVG. One piece can produce several artworks (carousel) in several formats (feed, story, banner).

Interfaces: desktop app (Electron; editor with syntax highlighting and vim mode) and a CLI. Remote queues and delivery (Jira, Drive…) belong to Jacurutu, a sibling product; the boundary is a file contract (ADR 0011). Everything that is a source, sink, exporter, rasterizer, template pack or editor command is a **plugin** — built-ins use the same API.

Start with `CLAUDE.md`, then `docs/architecture.md` and `docs/backlog.md`.

```
docs/
  architecture.md          pipeline, packages, boundaries, patterns
  ir-schema.md             scene tree schema
  brief-language.md        brief syntax (directives + frontmatter)
  diagnostic-codes.md      every error and warning a stage can report (generated)
  template-authoring.md    how to write templates (human or AI agent)
  template-conventions.md  how to organise a template written in TypeScript
  slot-vocabulary.md       the slot names a template reaches for first
  format-kinds.md          what each format is for, and how formats are named
  plugin-api.md            extension points and host API
  plugin-authoring.md      how to write, install and share a plugin (human or AI agent)
  integrations.md          Jacurutu boundary, local inbox/outbox, deferred remote sources
  render-contract.md       what a program outside Tyto can rely on (generated)
  render-result.schema.json  the JSON Schema of result.json (generated)
  conventions.md           stack, tooling, tests
  git-workflow.md          branches, PRs, releases, GitHub workflows
  backlog.md               ordered epics and stories → Jira cards
  patterns-explained.pt-BR.html  the project's patterns, for readers who do not write code
  adr/                     architecture decision records
  explorations/            design explorations that came before a decision
  releases/                the desktop release notes, as published
apps/docs/                 the user manual (VitePress), English at / and pt-BR at /pt-BR/
```

Language policy: code, comments, docs, commits and Jira cards are in English. A card also carries a Portuguese half, which is **not** a translation — the maintainer reads English fine, so translating the body twice buys nothing. It says what the card adds for somebody who does not write code: one concrete thing a person can do afterwards that they could not do before, and one sentence on what still does not work. The maintainer reads English and writes to AI agents in Portuguese.

The `## Português

O Tyto monta arte publicitária a partir de um arquivo de texto, na sua própria máquina.
Faz parte da suíte Breu.

**O que você escreve.** Um arquivo — o _brief_ — com o texto da peça, as imagens e as
opções que ela aceita. Não é editor de imagem: você não arrasta caixa, não escolhe posição,
não mexe em tamanho. Quem sabe onde cada coisa fica é o _template_, que alguém de design
escreve uma vez e todo mundo reusa.

**O que sai.** As artes prontas, em todos os tamanhos que a campanha pede — grid, story,
banner — do mesmo brief e de uma vez só. Um carrossel de cinco slides vira cinco artes em
cada tamanho. Saem em PNG, JPEG e WebP, e também em SVG.

**Por que isso resolve algo.** Mudou o preço, mudou a data, mudou uma palavra: você edita uma
linha e gera tudo de novo em segundos, sem refazer doze arquivos à mão. E o mesmo brief
sempre produz as mesmas imagens — não "parecidas", idênticas. É isso que permite mandar
gerar sem ter que conferir peça por peça.

**Como se usa.** Pelo programa de mesa, para Windows, macOS e Linux: você abre ou cria um
brief, escreve, vê a prévia desenhada ao lado enquanto digita, o painel de problemas aponta a
linha de qualquer erro, e o botão Exportar grava as imagens numa pasta. A janela fala
português ou inglês conforme a máquina, e o programa instalado no Windows e no Linux se
atualiza sozinho. As fontes que os templates usam vêm junto. Para automatizar, a mesma coisa
existe na linha de comando (`tyto`).

**O que ainda não funciona.** Os instaladores ainda não são assinados, então o Windows e o
macOS avisam na primeira vez que você abre. O arquivo de Mac da versão 0.7.0 só abre em Mac
com Apple Silicon. Plugins só se instalam pela linha de comando. E não há integração com Jira
ou Drive: isso é papel do Jacurutu, o outro produto da suíte.

**O manual.** Instalação, primeira arte passo a passo e o nome de cada parte da janela estão
no manual do usuário, em `apps/docs/pages/pt-BR/` (comece por
[Primeiros passos](apps/docs/pages/pt-BR/get-started/index.md)). Ele ainda não está publicado
num endereço; para lê-lo como site, rode `pnpm --filter @tyto/docs dev` no repositório.

Para quem for mexer no código: comece por `CLAUDE.md`, depois `docs/architecture.md` e
`docs/backlog.md`. A documentação técnica está em inglês; a explicação dos padrões de projeto
para não-programadores está em `docs/patterns-explained.pt-BR.html`.
