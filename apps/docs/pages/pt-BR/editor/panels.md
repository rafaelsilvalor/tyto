# Painéis

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

Os painéis ficam em três **áreas** em volta dos grupos de editores: esquerda, direita e de baixo. Os do próprio Tyto são o **Explorador**, **Problemas**, **Projeto** e a **fila local**, e um plugin pode acrescentar os seus. A prévia não é um painel: é uma aba, e tem a sua própria parte mais abaixo.

## Mostrar e esconder

- Os botões nas duas pontas da barra de status mostram e escondem uma área inteira: **Mostrar ou ocultar a área esquerda** à esquerda, **Mostrar ou ocultar a área de baixo** à direita. Os mesmos comandos estão na barra de comandos, com um para a área direita.
- A contagem de problemas na barra de status mostra e esconde **Problemas**; o botão da fila ao lado faz o mesmo com a **fila local**, assim como **Mostrar a fila local** na barra de comandos.
- O **×** à direita do cabeçalho de um painel o esconde.
- **Restaurar a disposição padrão** devolve cada painel ao lugar onde o Tyto o colocou de início: Problemas aberto na área de baixo, a fila fechada.

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

O Explorador lista os arquivos da [pasta de trabalho](workspace-folder.md#ver-os-arquivos-dela-o-explorador) aberta, na área esquerda, acima da fila. Abrir uma pasta abre o Explorador, e clicar num brief nele abre o brief numa aba.

## A fila local

A fila renderiza briefs que outros programas deixam numa pasta. Ela abre na área esquerda; [A pasta da fila](../export/queue-folder.md) explica como configurá-la e o que ela grava.

## Prévia

A prévia desenha o brief enquanto você digita. **Abrir a prévia ao lado** (**Ctrl+Shift+V**, ou o botão no fim da fileira de abas de um grupo) a abre num grupo só dela; **Abrir a prévia** a abre como aba no grupo em que você está.

A barra dela tem:

- um botão para cada formato que o brief pede — clique num para ver aquele tamanho;
- **Slide** e um número para cada arte de um carrossel;
- **−**, o zoom, **+** e **Ajustar**, que encaixa a arte no espaço;
- **Travar**. A prévia normalmente acompanha o brief da frente; travada, ela fica no brief que está mostrando enquanto você troca de aba, e a aba dela avisa. **Travar ou destravar a prévia** faz o mesmo pela barra de comandos.

Enquanto o brief tem um erro, a prévia mantém o último desenho que funcionou, e o painel de Problemas diz o que corrigir.
