# Abas e grupos de editores

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

Cada arquivo aberto é uma **aba**. Uma fileira de abas com o arquivo da frente é um **grupo de editores**; a janela começa com um grupo para o seu brief e outro para a prévia dele.

## Abrir, trocar e fechar

- **Novo brief** (**Ctrl+N**) abre um brief vazio, e **Abrir…** (**Ctrl+O**) abre um do disco. Os dois também estão no menu **Arquivo**.
- Clique numa aba para trazê-la para a frente. **Ctrl+PageDown** e **Ctrl+PageUp** vão para a aba seguinte e para a anterior, e **Ctrl+1** a **Ctrl+9** vão direto para uma aba pela posição dela na fileira.
- Feche uma aba pelo **×** dela ou por **Fechar a aba** (**Ctrl+W**). Uma aba com alterações ainda não salvas mostra um ponto depois do nome, e fechá-la pergunta antes: **Cancelar** a mantém aberta, **Fechar sem salvar** descarta as alterações.

## Reabrir um arquivo que você fechou

Não há comando que traga de volta a última aba fechada. Os arquivos abertos recentemente estão na barra de comandos: aperte **Ctrl+K**, digite parte do nome do arquivo e escolha a linha que começa com **Recente:**.

## Dividir

**Dividir editor à direita** (**Ctrl+\\**) e **Dividir editor para baixo** (**Ctrl+Shift+\\**) criam um grupo novo ao lado ou abaixo daquele em que você está, mostrando o mesmo arquivo. Os dois grupos mostram o mesmo texto: o que você digita num aparece no outro, então dá para olhar o começo de um brief longo enquanto escreve o fim.

Passe de um grupo a outro com **Focar o próximo grupo de editores** (**Ctrl+Alt+Seta para a direita**) e **Focar o grupo de editores anterior** (**Ctrl+Alt+Seta para a esquerda**). Arraste a linha entre dois grupos para mudar o espaço de cada um.

O botão no fim da fileira de abas de um grupo é **Abrir a prévia ao lado**: ele abre a prévia do brief num grupo só dela. [Painéis](./panels.md#previa) fala mais da prévia.

## Mover uma aba

- **Arraste** uma aba pela fileira para mudar a posição dela, ou para a fileira de outro grupo de editores para levá-la para lá. A aba de um brief não entra no grupo que contém uma prévia.
- **Mover a aba para a esquerda** (**Ctrl+Shift+PageUp**) e **Mover a aba para a direita** (**Ctrl+Shift+PageDown**) fazem o mesmo pelo teclado.
- **Mover a aba para o próximo grupo de editores** manda a aba da frente para o grupo seguinte.

## Fechar um grupo

**Fechar o grupo de editores** fecha o grupo em que você está **e as abas dele**: um arquivo aberto só naquele grupo é fechado, e um com alterações não salvas pergunta antes, como fechar a aba perguntaria. Os outros grupos se alargam para ocupar o espaço.

Os comandos de dividir, os de mover e **Fechar o grupo de editores** também estão no menu **Exibir**.

## O que a janela lembra

Quando a janela fecha, ela guarda os arquivos que estavam abertos, os grupos em que estavam e onde ficavam os painéis, e devolve tudo na próxima vez que abrir.
