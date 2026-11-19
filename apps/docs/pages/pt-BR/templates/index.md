# Templates

Um **template** é o desenho em que a arte é feita: onde vai o título, qual fonte, quais cores, quais tamanhos. Um [brief](../briefs/) só o preenche. O Tyto vem com um conjunto de templates, e você pode acrescentar os seus.

## Como escolher um template

A [galeria de templates](./gallery.md) mostra todos os templates que vêm com o Tyto: uma imagem, para que serve, os tamanhos que desenha e os slots que um brief preenche. Para escolher:

1. **Comece pela peça que você precisa.** Cada template diz o que faz — um post de grid, um carrossel, um story, stories ou um banner — e em quais formatos. Para uma série de slides, use um template de carrossel; um template de grid faz uma imagem.
2. **Confira a marca.** A maioria dos templates desenha o visual de uma marca, e a galeria diz qual.
3. **Leia os slots.** São o que o seu brief vai ter que dizer. Um slot _obrigatório_ precisa estar em todo brief; um slot de lista mostra os valores que você pode escolher.

Na janela, **Novo brief a partir de template…** lista todos os templates que você pode usar, com a pasta de onde cada um veio, e abre um brief novo com os slots daquele template já escritos. Na linha de comando, a linha `template:` do brief ou `--template` escolhe o template.

## Arte pintada em outro programa

Alguns templates deixam uma imagem para ser pintada fora, num editor de imagens: um fundo que cobre a peça, ou uma ilustração abaixo do título. O template diz o tamanho dessa arte em cada formato. Enquanto o arquivo não existe, o brief continua renderizando: o lugar da arte é uma **caixa contornada em magenta**, no tamanho e na posição que a arte vai ocupar, e o painel de problemas mostra `W_EXTERNAL_ART_MISSING` para cada uma. Quando o arquivo estiver pronto, escreva o caminho dele no brief, como qualquer imagem, e a caixa dá lugar à arte. O `arte-teste` na [galeria](./gallery.md) mostra isso.

## Quando nenhum template serve

Templates são pastas de arquivos simples: um `manifest.yaml` que lista os slots e os tamanhos, e um `template.html` que os desenha. **Novo template…** escreve um que já funciona para você alterar, e a [sua pasta de templates](./templates-folder.md) é onde ficam os seus. Escrever um template do zero está no [guia de autoria de templates](../extend/), em inglês.
