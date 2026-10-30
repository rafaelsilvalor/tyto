# Sua primeira arte

Da janela vazia a arquivos PNG no disco, em seis passos. Você cria um template pequeno, só seu, escreve um brief que o preenche, acompanha a prévia, provoca um problema de propósito, corrige e exporta.

::: info Como esta página foi conferida
Cada passo foi seguido em 18/10/2026 numa versão de desenvolvimento do Tyto 0.7.0 (commit `639ca82`) no Windows 11, uma vez com a janela em português do Brasil e outra em inglês. Os menus e rótulos abaixo são os da janela em português.
:::

Todo passo usa a **barra de comandos**: aperte **Ctrl+K** (**Cmd+K** no macOS), digite algumas palavras do nome do comando, confira que ele está na primeira linha e aperte **Enter**. A página [Conheça a janela](./window-tour.md) dá nome às partes que esta página cita.

## Antes de começar

Na primeira vez que abre, a janela tem uma aba **Sem título** com a prévia ao lado, e o painel de problemas já mostra `E_NO_TEMPLATE`: um brief vazio ainda não diz qual template usa. Pode deixar essa aba como está.

Crie uma pasta vazia para os seus templates onde quiser — por exemplo `Templates do Tyto` em Documentos.

## 1. Escolha a pasta de templates

Rode **Escolher pasta de templates…** e escolha a pasta que você criou. O Tyto passa a procurar templates nela.

O painel de problemas mostra `E_TEMPLATE_FOLDER_EMPTY` (um aviso: a pasta ainda não tem templates). O próximo passo resolve isso.

## 2. Crie um template

Rode **Novo template…**. A janela vira **Editando template**, com uma caixa no alto à direita para o nome. Digite `first-card` e aperte **Enter** (ou **Criar**).

O Tyto grava um template inicial pequeno em `Templates do Tyto\first-card` e o mostra: `manifest.yaml` e `template.html` à esquerda e, à direita, o brief de exemplo desenhado em todos os formatos do template — `grid`, `grid-1x1`, `story`, `banner` e mais dois. O template inicial tem um campo chamado `titulo`, um campo de imagem chamado `imagem` e uma escolha de cor chamada `tom`, que aceita `azul` ou `laranja`.

Clique em **Fechar**. O template já está na pasta: o `E_TEMPLATE_FOLDER_EMPTY` some do painel de problemas, e o `first-card` aparece na lista do próximo passo.

## 3. Escreva um brief

Rode **Novo brief a partir de template…**. A barra de comandos lista todos os templates com a pasta de onde cada um veio; digite `first-card` e aperte **Enter**.

Uma aba nova abre com o esqueleto do template, e a palavra `titulo` depois de `::titulo` fica selecionada:

```
---
template: first-card
formats: [grid, grid-1x1, story, banner, banner-1x1, banner-345x146]
---

::titulo titulo
```

Digite o seu título por cima — esta página usou `Uma lista de leitura para o outono`.

## 4. Acompanhe a prévia

A prévia ao lado do editor desenha o brief enquanto você digita: fundo azul-escuro, com o título em branco. A barra dela tem um botão por formato; clique em **story** para ver a versão vertical, e em **Ajustar** para caber no espaço.

## 5. Provoque um problema e corrija

Ponha o cursor no fim da linha `formats:`, aperte **Enter** e digite:

```
tom: verde
```

`verde` não é uma das cores que o template aceita. Em um instante:

- o painel de problemas mostra `E_BAD_SLOT_VALUE` — `Slot 'tom' is invalid: 'verde' is not one of azul, laranja.` — em `4:1`. As mensagens de problema ainda aparecem em inglês, mesmo com a janela em português;
- `tom` fica sublinhado no editor, e a barra de status conta um problema;
- a prévia mantém o último desenho que deu certo.

Clique no problema: o cursor vai para a linha 4 e seleciona `tom`. Troque `verde` por `laranja`. O problema some e a prévia fica laranja.

## 6. Salve e exporte

Aperte **Ctrl+S** (**Cmd+S**) e salve o brief como `lista-de-leitura.brief`, em qualquer pasta. A aba e a barra de título passam a mostrar o nome.

Rode **Exportar…** (ou clique no botão de exportar da barra de status). Na caixa:

1. **Pasta de destino ▸ Escolher…** — escolha uma pasta vazia para as imagens.
2. **Formatos** — deixe todos marcados.
3. Clique em **Exportar**.

A caixa conta `6 / 6` e diz **Exportação concluída**; **Abrir pasta** abre o destino. Nele:

| Arquivo                 | Tamanho     |
| ----------------------- | ----------- |
| `grid-01.png`           | 1080 × 1350 |
| `grid-1x1-01.png`       | 1080 × 1080 |
| `story-01.png`          | 1080 × 1920 |
| `banner-01.png`         | 1200 × 628  |
| `banner-1x1-01.png`     | 600 × 600   |
| `banner-345x146-01.png` | 345 × 146   |

e nada mais: a pasta guarda só as imagens.

## Para onde ir agora

- [Conheça a janela](./window-tour.md) — o nome de tudo que você acabou de usar.
- [Comandos](../reference/commands.md) — todos os comandos da barra e seus atalhos.
- Para mudar a aparência do `first-card`, o guia de quem escreve templates está em [Estender](../extend/).
