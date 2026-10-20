# Atalhos de teclado

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `b039537`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

Cada tecla executa um comando, e o `keybindings.json` muda qual. Abra-o com **Preferências: Abrir atalhos de teclado (JSON)**. Ele começa como uma lista vazia com três linhas de anotação explicando como preenchê-la.

## Dar uma tecla a um comando

Acrescente uma entrada com a `key` (tecla) e o `id` do comando. A barra de comandos não mostra os ids; [Comandos](../reference/commands.md) lista o id de cada comando.

```jsonc
[
  // Liga e desliga o vim com uma tecla.
  { "key": "ctrl+alt+v", "command": "editor.toggleVim" },
]
```

Salve, e a tecla funciona na hora. A barra de comandos mostra a tecla nova ao lado do comando.

## Só em alguns lugares: `when`

Um `when` limita uma tecla a um **contexto** — com o editor em foco, com o vim no modo normal, com a barra de comandos aberta. [Atalhos de teclado](../reference/keyboard-shortcuts.md#contextos) lista os contextos.

```jsonc
// Ir para bloco no Ctrl+Alt+B, mas só com o vim no modo normal.
{ "key": "ctrl+alt+b", "command": "editor.goToBlock", "when": "vim.normal" }
```

Com o vim desligado, **Ctrl+Alt+B** não faz nada; com o vim ligado e no modo normal, abre o Ir para bloco.

## Tirar uma tecla

Ponha um `-` antes do id do comando para tirar uma tecla que ele tem por padrão:

```jsonc
// Arrumar brief só pela barra de comandos.
{ "key": "alt+shift+f", "command": "-editor.formatBrief" }
```

Aí **Alt+Shift+F** não faz nada, e a barra de comandos mostra **Arrumar brief** sem tecla.

## O Ctrl+K fica

**Ctrl+K** (**Cmd+K** no macOS) sempre abre a barra de comandos: é por ela que se chega a todo comando, inclusive aos que abrem este arquivo. Uma entrada que o dá a outro comando, ou o tira, é recusada, e o painel de Problemas avisa:

```
W_KEYBINDING_LOCKED  Key 'ctrl+k' cannot run 'editor.save': it opens the command bar, the way to every command.
```

## Quando uma entrada está errada

Cada erro aparece no painel de Problemas com a linha, e as outras entradas continuam valendo. Um id que nenhum comando tem é `W_KEYBINDING_UNKNOWN_COMMAND`; um arquivo que não é uma lista de entradas `{ "key", "command" }` é `E_KEYBINDINGS_SYNTAX`, e aí a janela mantém as teclas que tinha até o arquivo ser corrigido.

Cada tecla padrão está em [Atalhos de teclado](../reference/keyboard-shortcuts.md).
