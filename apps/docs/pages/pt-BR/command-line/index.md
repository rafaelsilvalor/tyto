# Linha de comando

::: info Como esta página foi conferida
Cada comando foi executado em 2026-10-19 num build do repositório no commit `b039537` (CLI 0.4.1) no Windows 11. As saídas abaixo foram copiadas dessas execuções; quando uma é longa, aparecem as primeiras linhas e a página avisa. O comando fala inglês, então as saídas estão em inglês.
:::

O comando `tyto` faz pelo terminal o que a janela faz: renderiza um brief, vigia uma pasta à espera de briefs, confere e cria templates, e cuida dos plugins. É o que um script, uma tarefa agendada ou outro programa usa.

## Obter o comando

O `tyto` ainda não vem no instalador do aplicativo. Ele roda a partir de uma cópia do [repositório](https://github.com/rafaelsilvalor/tyto), com o [Node.js](https://nodejs.org) 22 ou 24 e o [pnpm](https://pnpm.io):

1. Pegue o repositório e instale o que ele precisa: `pnpm install` na pasta dele.
2. Monte o comando e confira que ele responde:

   ```
   $ pnpm cli --version
   0.4.1
   ```

3. Daí em diante, rode-o de qualquer pasta como `node <repositório>/apps/cli/dist/index.js`. Estas páginas escrevem `tyto` para encurtar; um alias no terminal ou um pequeno script chamado `tyto` deixa isso literal.

<!-- O CLI não vem em nenhum instalador (apps/cli é privado); candidato a carta levantado na TYTO-317. -->

## Antes da primeira renderização: tamanhos e templates

`tyto render` e `tyto watch` leem duas coisas da pasta em que você os executa:

- **`formats.yaml`**, os tamanhos — `grid` é 1080 × 1350, `story` 1080 × 1920 e assim por diante. Sem ele, a renderização para com `E_FORMATS_READ`. Copie o que o Tyto usa, `packages/templates/templates/formats.yaml` no repositório, para a sua pasta, ou aponte para ele com `--formats-file`. [Formatos](../briefs/formats.md) explica o arquivo.
- **`templates/`**, os seus templates, uma subpasta para cada, como na [sua pasta de templates](../templates/templates-folder.md). É opcional: os templates que vêm com o Tyto estão sempre lá, e `--templates` aponta outra pasta.

## O que todo comando tem em comum

- `tyto --help` lista os comandos, e `tyto <comando> --help` as opções de um. [Linha de comando](../reference/command-line.md) na Referência tem cada opção de cada comando; estas páginas dizem para que usá-las.
- **Códigos de saída**: `0` quando tudo deu certo, `1` quando o brief ou a linha de comando tem um erro, `2` quando o próprio Tyto falhou. Um script pode parar em qualquer coisa que não seja `0`.
- **`--json`** imprime um documento que um programa consegue ler, em vez de frases.

## Nesta seção

- [Renderizar um brief](./render.md) — arquivos a partir de um brief.
- [Vigiar uma pasta](./watch.md) — renderizar o que chegar numa pasta de fila.
- [Templates](./templates.md) — conferir um template e começar um novo.
- [Plugins](./plugins.md) — instalar, listar, desligar e remover.
