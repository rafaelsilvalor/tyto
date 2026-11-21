# Gabaritos para arte externa

::: info Como esta página foi conferida
Conferida em 2026-11-20 numa versão de desenvolvimento do Tyto no Windows 11, com o template embutido `arte-teste` e uma pasta nova em que a janela ainda não confiava, conduzindo a janela como `e2e/art-guide.desktop.test.ts` conduz: o comando, as caixas de marcar, Inserir a linha e o desfazer, Salvar o brief antes, o gabarito gravado mostrado na pasta e o PNG pintado desenhado na prévia. As respostas "aberto" e "nenhum programa" e a pergunta antes de substituir um gabarito foram lidas no código, não executadas. Os rótulos em português foram lidos no catálogo da janela.
:::

Alguns templates deixam uma imagem para ser pintada em outro programa, como um fundo ou uma ilustração abaixo do título. Enquanto essa imagem não existe, a prévia desenha uma caixa magenta contornada onde ela vai, e o painel Problemas mostra `W_EXTERNAL_ART_MISSING`. Um **gabarito** é um PSD em camadas no tamanho exato da imagem, gravado ao lado do arquivo que o brief cita: quem pinta abre o gabarito, pinta e salva o PNG com o nome que o brief lê de volta.

A linha de comando grava os mesmos gabaritos com [`tyto guide`](../command-line/render.md#gravar-cada-gabarito-ao-lado-da-arte-tyto-guide); esta página é o caminho da janela.

## Gerar os gabaritos

1. Abra o brief, aperte **Ctrl+K** e rode **Gerar gabarito para arte externa**.
2. A caixa lista uma linha por gabarito: o slot, o arquivo do gabarito e a arte a salvar a partir dele, cada caminho relativo à pasta do brief. Um gabarito que ainda não existe vem **marcado**; um que já existe vem **desmarcado**, porque pode ter pintura.
3. Marque os gabaritos que quiser e aperte **Gerar gabaritos**.

Por exemplo, um brief que diz `fundo: grafico.png` e desenha um formato lista `assets\grafico.guide.psd`, e a arte a salvar é `assets\grafico.png`. Com vários formatos há uma linha por formato: `grafico.grid-1x1.guide.psd`, `grafico.story.guide.psd`, e a arte `grafico.grid-1x1.png`, `grafico.story.png`.

Abaixo da lista, depois de gerar, a caixa diz quais arquivos gravou e como eles chegaram até você:

- **Aberto no programa que abre PSD neste computador.** Cada gabarito abre nesse programa.
- **Nenhum programa abre PSD neste computador**: o gabarito aparece selecionado na pasta dele.
- **Esta pasta não é confiável**: o gabarito é gravado e aparece na pasta dele, sem ser aberto. Uma pasta em que você não confiou não pode iniciar um programa gravando um arquivo; [Pasta de trabalho](./workspace-folder.md) diz como confiar numa pasta.

## Salvar a pintura onde o brief lê

Salve a imagem pintada a partir do gabarito com o nome da coluna **Arte a salvar**. A prévia desenha a imagem assim que o arquivo é salvo, sem tecla nenhuma e sem mudar o brief.

## Citar o próprio PSD

Com um plugin instalado que decodifica arquivos PSD, o brief pode citar o PSD em vez de um PNG salvo a partir dele: `fundo: grafico.psd` desenha o arquivo inteiro, e `fundo: grafico.psd#arte` a camada chamada `arte` (uma camada dentro de um grupo é `grupo/arte`). Salvar o PSD de novo redesenha a prévia, sem tecla nenhuma. Sem esse plugin instalado, o painel de problemas mostra `E_ASSET_DECODER_MISSING` na linha do brief. Numa pasta em que você não confiou, nenhum plugin decodifica nada novo: uma imagem já decodificada antes continua aparecendo, e uma nova pede para confiar na pasta com **Workspace: Manage Trust**.

## Um brief com alterações não salvas

O gabarito é desenhado a partir do arquivo do brief, não do que está digitado. Quando o brief tem alterações não salvas, **Gerar gabaritos** pergunta antes **Salvar o brief antes?**. **Salvar e gerar** salva e grava os gabaritos; **Cancelar** não grava nada, e a caixa diz isso.

## Arte sem arquivo no brief

O gabarito leva o nome do arquivo que o brief cita, então um slot para o qual o brief não cita arquivo não tem gabarito. A caixa lista esses slots em **Arte sem arquivo no brief**, com a linha que citaria um, por exemplo `imagem: imagem.png`. **Inserir a linha** coloca a linha no brief (entre os dois `---`, ou no fim, para um bloco) como uma mudança só, que **Ctrl+Z** desfaz, e o gabarito do slot aparece na lista, marcado. O brief passa a ter alterações não salvas, então gerar pede para salvar antes.

Citações que não podem ter gabarito, como um item da fonte de um plugin ou um segundo fundo, aparecem em **Citações sem gabarito**, com a linha e o motivo.

## Um gabarito alterado depois do brief

Um gabarito salvo depois do brief pode ter o que alguém pintou nele. Marcar um e apertar **Gerar gabaritos** pergunta antes **Substituir gabaritos alterados depois do brief?**; **Manter**, o padrão, não grava nada.

## Um template sem arte externa

Quando o template do brief não declara imagem pintada fora, a caixa diz isso e nomeia o template, e não há o que gerar.
