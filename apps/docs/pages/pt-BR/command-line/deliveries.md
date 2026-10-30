# Entregas

::: info Como esta página foi conferida
Cada comando foi executado em 2026-10-30 num build de desenvolvimento da branch que o criou (TYTO-489) no Windows 11, numa pasta de trabalho cujo `.tyto/project.json` era `{ "delivery": { "parent": "entregas" } }`. As saídas abaixo foram copiadas dessas execuções.
:::

Uma **entrega** é uma pasta por peça de trabalho, com o nome do card: o brief, as imagens dele e, depois, a arte final, guardados juntos dentro do projeto. `tyto delivery new` cria uma; na janela, **Arquivo ▸ Entrega: nova…** cria ([Pasta de trabalho](../editor/workspace-folder.md#entregas-uma-pasta-por-peça-de-trabalho)).

## Criar uma entrega

Rode de qualquer lugar dentro da pasta de trabalho, com o nome que a pasta vai ter:

```
$ tyto delivery new mca-66910_simule-sua-nota-da-2ª-fase
entregas\mca-66910_simule-sua-nota-da-2ª-fase\editaveis\mca-66910_simule-sua-nota-da-2ª-fase.brief
```

Ele cria a pasta, `assets/` e `editaveis/` dentro dela, e um brief vazio com o nome da entrega em `editaveis/`. A linha que ele imprime é o caminho do brief, sozinho, para um script poder abri-lo. As imagens que você puser em `assets/` são encontradas pelo brief, porque um brief em `editaveis/` lê `../assets`.

Fora de qualquer pasta de trabalho, a entrega é criada na pasta em que você está, com o mesmo arranjo.

## Começar o brief de um template

`--template` (ou `-t`) escreve no brief o esqueleto do template em vez de deixá-lo vazio: o mesmo texto que **Novo brief a partir de template…** escreve na janela, com os slots obrigatórios do template e os tamanhos dele.

```
$ tyto delivery new mca-66911_aprovados -t aprovados
entregas\mca-66911_aprovados\editaveis\mca-66911_aprovados.brief
```

O nome pode ser um template, ou um apelido que um [arquivo de plugins](./plugins.md#configurações-e-apelidos) define; o esqueleto próprio de uma configuração é usado quando ela tem um. Numa pasta em que você ainda não confiou, os arquivos de plugins que a pasta traz não são carregados; `--trust` confia na pasta e no perfil de trabalho dela só nesta execução, como em `tyto render`.

## Uma pasta que já existe

Uma pasta de entrega que já existe é **usada como está**: as pastas que faltam são criadas e o que está nela fica. Você pode criar a pasta à mão, ou pôr as imagens primeiro, e rodar o comando depois.

Um brief que já existe **nunca é sobrescrito**. O comando para, não escreve nada — nem uma pasta que faltava — e sai com 1:

```
$ tyto delivery new mca-66910_simule-sua-nota-da-2ª-fase
error E_DELIVERY_BRIEF_EXISTS 'entregas\mca-66910_simule-sua-nota-da-2ª-fase\editaveis\mca-66910_simule-sua-nota-da-2ª-fase.brief' already exists, and a delivery's brief is never overwritten; nothing is written.
```

Uma entrega sempre fica dentro da pasta de trabalho. Uma que um atalho dentro da pasta levaria para fora é recusada com `E_DELIVERY_PATH_OUTSIDE`, e nada é escrito.

## Exportar uma entrega

`tyto render` com `--delivery` exporta o brief de uma entrega para dentro da própria entrega, sem pasta para nomear:

```
tyto render entregas/mca-66910/editaveis/mca-66910.brief --delivery
```

As artes vão para a raiz da entrega, ou para a pasta `exports` dela quando a chave `delivery` nomeia uma; o `result.json` e o `template.txt` vão para `editaveis/`, ao lado do brief. O brief e as imagens ficam como estão. Artes que uma exportação anterior da entrega gravou e esta não são removidas, com um aviso `W_LEFTOVER_REMOVED`. Ela exporta os tamanhos do próprio brief em PNG, a não ser que a chave `delivery` nomeie `formats` ou `types`; `--formats` e `--types` ainda escolhem para uma execução.

`--delivery` não pode ser usado com `--out` nem `--folder`: a entrega decide para onde os arquivos vão. Um brief que não está no `editaveis/` de uma entrega é recusado com `E_BRIEF_NOT_IN_DELIVERY`, e nada é renderizado.

## Que nomes funcionam

O nome vira o nome de uma pasta, então é recusado, nunca alterado, quando uma pasta não poderia tê-lo: vazio, começando com ponto, contendo `..`, `/`, `\` ou um de `< > : " | ? *`, terminando em espaço ou ponto, ou um nome que o Windows reserva, como `CON`. Pode ter até 100 caracteres, e qualquer outra letra serve, `ª` e acentos incluídos.

```
$ tyto delivery new "mca:1"
warning W_DELIVERY_NAME_INVALID The delivery name 'mca:1' holds a character a folder name may not; no delivery is made.
```

## Mudar o arranjo

Onde as entregas são criadas, que pastas cada uma recebe e onde o brief fica são definidos pela chave `delivery` do arquivo de projeto ou de um perfil de trabalho; [Pasta de trabalho](../editor/workspace-folder.md#entregas-uma-pasta-por-peça-de-trabalho) a descreve.
