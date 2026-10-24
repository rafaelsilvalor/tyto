# Modo vim

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

O editor do Tyto aceita as teclas do vim: os modos normal, de inserção, visual e de substituição, os movimentos e os comandos com `:`.

## Ligar e desligar

1. Aperte **Ctrl+K** para abrir a barra de comandos.
2. Digite `vim` e execute **Editor: ligar ou desligar o modo vim**.

O mesmo comando desliga. Ele não tem tecla própria; [Atalhos de teclado](../customize/keybindings-json.md) explica como dar uma a ele.

Com o vim ligado, a barra de status mostra o modo em que você está — **NORMAL**, **INSERT**, **VISUAL** ou **REPLACE**, em inglês como no vim — e as teclas de um comando que você começou a digitar. A aparência desse selo é a configuração [`vimModeStyle`](../reference/settings.md#vimmodestyle), e as cores dele estão em [`statusBarColors`](../reference/settings.md#statusbarcolors).

A escolha fica guardada: o comando grava a configuração [`vimMode`](../reference/settings.md#vimmode), então depois de um reinício a janela abre com o vim do jeito que você deixou. Você também pode escrever `"vimMode": true` ou `false` no `settings.json`; salvar o arquivo já liga ou desliga o vim.

## O que muda com ele ligado

- As teclas do próprio vim valem dentro do editor: **u** desfaz, **Ctrl+R** refaz, **:w** salva e **:vsplit** divide o grupo de editores, como **Dividir editor à direita**.
- Algumas teclas da janela passam a ser do vim. **Ctrl+O**, por exemplo, é do vim e não abre mais um arquivo: use **Abrir um brief…** pela barra de comandos ou pelo menu **Arquivo**. A barra de comandos mostra as teclas que cada comando tem naquele momento, então um comando que perdeu a tecla com o vim ligado aparece sem nenhuma.
- **Ctrl+K** continua abrindo a barra de comandos, então todo comando continua a uma busca de distância.
