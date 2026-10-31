# Painéis

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português. A seção sobre uma imagem do Explorador foi seguida em 2026-10-23 numa versão de desenvolvimento, na janela em inglês, no tema claro e no escuro.
:::

Os painéis ficam em três **áreas** em volta dos grupos de editores: esquerda, direita e de baixo. Os do próprio Tyto são o **Explorador**, **Problemas**, **[Comandos](commands.md)**, **[Terminal](terminal.md)**, **Projeto** e a **fila local**, e um plugin pode acrescentar os seus. A prévia não é um painel: é uma aba, e tem a sua própria parte mais abaixo.

A área de baixo mostra **um painel por vez**, como abas no alto dela: **PROBLEMAS**, com a contagem, depois **COMANDOS** e **TERMINAL**, e **PROJETO** ou o painel de um plugin enquanto estiverem abertos. Clique numa aba, ou use **←** e **→** sobre ela, para trazê-la para a frente; o Tyto lembra qual estava. A área mantém a altura qualquer que seja a aba da frente. As áreas da esquerda e da direita mostram seus painéis um embaixo do outro.

## Mostrar e esconder

- Os botões nas duas pontas da barra de status mostram e escondem uma área inteira: **Mostrar ou ocultar a área esquerda** à esquerda, **Mostrar ou ocultar a área de baixo** à direita. Os mesmos comandos estão na barra de comandos, com um para a área direita.
- A contagem de problemas na barra de status mostra e esconde **Problemas**; o botão da fila ao lado faz o mesmo com a **fila local**, assim como **Mostrar a fila local** na barra de comandos. **Ctrl+`** mostra e esconde [Comandos](commands.md), e **Ctrl+Shift+`** abre um [terminal](terminal.md) novo.
- O **×** à direita do cabeçalho de um painel o esconde. Na área inferior, ele esconde a área inteira, e as abas voltam com ela.
- **Restaurar a disposição padrão** devolve cada painel ao lugar onde o Tyto o colocou de início: Problemas aberto na área de baixo, a fila fechada.

## Comandos

A aba **COMANDOS** roda comandos `tyto` na janela. Cada comando que você roda é um bloco: um cabeçalho com o comando, os caminhos cortados para o nome do arquivo, a hora em que começou e como terminou — **✓ 0** quando deu certo, **✗ 1** quando o brief tem erros — sobre o que ele imprimiu, com um espaço antes do próximo. O mesmo cabeçalho dá nome à seção dele em Problemas.

Duas configurações do `settings.json` mudam como os blocos ficam, e valem assim que o arquivo é salvo:

- `commandsOrder`: `"newestLast"`, o padrão, põe cada execução embaixo da anterior e o prompt por último, como num terminal; `"newestFirst"` põe o prompt primeiro e a execução mais nova logo abaixo. As seções de comandos em Problemas seguem a mesma ordem.
- `commandsFoldOlderRuns`: `true` recolhe todas as execuções, menos a mais nova, à linha do cabeçalho; clique num cabeçalho para abri-lo. **Ctrl+F** abre uma execução recolhida que tenha uma ocorrência.

```json
{
  "commandsOrder": "newestFirst",
  "commandsFoldOlderRuns": true
}
```

## Problemas

<Screenshot
  scene="problems-panel"
  alt="Um brief com um bloco desconhecido, sublinhado no editor, e o painel de Problemas embaixo apontando o bloco com o código e a linha."
/>

Problemas lista o que está errado no brief da frente: cada linha tem um **código**, como `E_UNKNOWN_SLOT`, uma frase dizendo o que está errado, e a linha e a coluna. **Clique numa linha** para ir até lá: o cursor cai no texto de que o problema fala, já selecionado. O mesmo texto aparece sublinhado no editor, e a barra de status conta os problemas.

Um brief sem problemas diz isso, em vez de deixar o painel vazio. As frases dos problemas ainda aparecem em inglês com a janela em português. Os códigos mais comuns ao escrever estão explicados em [Briefs](../briefs/index.md#quando-algo-esta-errado).

<!-- TYTO-342: mensagens de problema ainda em inglês na janela em português. -->

<!-- TYTO-322: com o settings.json na frente o painel ainda diz "sobre este brief"; quer dizer o arquivo da frente. -->

## Explorador

O Explorador lista os arquivos da [pasta de trabalho](workspace-folder.md#ver-os-arquivos-dela-o-explorador) aberta, na área esquerda, acima da fila. Abrir uma pasta abre o Explorador, e clicar num brief nele abre o brief numa aba. Clique com o botão direito numa entrada (ou aperte **Shift+F10** ou a tecla **Menu** nela), ou aperte **F2** ou **Delete** nela, para [criar, renomear ou excluir](workspace-folder.md#criar-renomear-e-excluir) arquivos e pastas; excluir pergunta antes e vai para a Lixeira. Os botões do cabeçalho dele, ao lado do **×**, são **Novo arquivo…**, **Nova pasta…** e **Recolher tudo**.

## A fila local

A fila renderiza briefs que outros programas deixam numa pasta. Ela abre na área esquerda; [A pasta da fila](../export/queue-folder.md) explica como configurá-la e o que ela grava.

## Prévia

A prévia desenha o brief enquanto você digita. **Abrir a prévia ao lado** (**Ctrl+Shift+V**, ou o botão no fim da fileira de abas de um grupo) a abre num grupo só dela; **Abrir a prévia** a abre como aba no grupo em que você está.

A barra dela tem:

- um botão para cada formato que o brief pede — clique num para ver aquele tamanho;
- **Um slide** e **Todos os slides**, os dois modos da prévia, num carrossel;
- um botão que esconde ou mostra a faixa de slides, em Um slide;
- **−**, o zoom, **+** e **Ajustar**, que encaixa a arte no espaço;
- **Travar**. A prévia normalmente acompanha o brief da frente; travada, ela fica no brief que está mostrando enquanto você troca de aba, e a aba dela avisa. **Travar ou destravar a prévia** faz o mesmo pela barra de comandos.

Embaixo da arte de um carrossel fica a **faixa de slides**: todos os slides no formato escolhido, pequenos e numerados a partir de 1. Clique num para mostrá-lo em cima — o editor pula para o `::lamina` que o fez — ou, com a faixa em foco, ande com **←**, **→**, **Home** e **End**. A faixa rola para o lado quando os slides não cabem, e cada aba de prévia lembra se você a escondeu.

<Screenshot
  scene="preview-strip"
  alt="Um carrossel de seis slides na prévia: o primeiro slide grande e, embaixo, a faixa de slides com os seis, numerados de 1 a 6, o primeiro marcado."
/>

**Todos os slides** mostra de uma vez todos os slides no formato escolhido, numa grade, em ordem e numerados, cada um reduzido para que todos caibam na prévia. É ali que aparece um título que quebra só num slide, ou uma cor que muda de um slide para outro. **Clique num slide** para abri-lo: a prévia volta para Um slide com aquele slide grande, e o editor pula para o `::lamina` dele. A grade só rola para baixo quando há slides demais para caber num tamanho legível.

<Screenshot
  scene="preview-all-slides"
  alt="O mesmo carrossel em Todos os slides: os seis slides em duas fileiras de três, numerados de 1 a 6, com Todos os slides apertado na barra da prévia."
/>

Cada aba de prévia lembra o seu modo, também depois de recarregar a janela ou de fechar e abrir o Tyto de novo. **Prévia: mostrar todos os slides** e **Prévia: mostrar um slide** trocam o modo pela barra de comandos. Um brief de um slide só não tem modos: ele aparece sempre grande.

Enquanto o brief tem um erro, a prévia mantém o último desenho que funcionou, e o painel de Problemas diz o que corrigir.

### Uma imagem do Explorador

Clicar numa imagem no [Explorador](./workspace-folder.md#ver-os-arquivos-dela-o-explorador) a mostra na prévia que segue, ou abre uma do jeito que **Abrir a prévia** abre. A barra dela diz o nome do arquivo, o tamanho em pixels e o tamanho em disco — _logo.png · 1200 × 630 px · 84 KB_ — no lugar dos formatos; um SVG que não diz o próprio tamanho aparece no tamanho do `viewBox` e marcado _escalável_. O zoom, **Ajustar** e **Travar** funcionam como para um brief, e **Ajustar** nunca aumenta uma imagem além do tamanho dela.

Trazer a aba de um brief para a frente faz a prévia que segue mostrar aquele brief de novo; uma prévia travada fica com a imagem. Uma imagem alterada no disco aparece de novo; uma apagada ou tirada da pasta devolve a prévia que segue ao brief, e uma travada diz _Este arquivo não está mais na pasta._ Uma imagem de mais de 32 MB não é carregada, e um arquivo cujo conteúdo não é a imagem que o nome diz não aparece; a prévia diz qual dos dois. Um SVG aparece como figura: os scripts dele não rodam e ele não carrega nada da internet. Uma prévia travada numa imagem não volta quando o Tyto abre de novo.
