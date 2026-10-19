# A barra de status

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `b039537`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

A barra de status é a faixa no rodapé da janela. [Conheça a janela](../get-started/window-tour.md) dá nome ao que fica nela.

## Escolher o que aparece

[`statusBarItems`](../reference/settings.md#statusbaritems) é a lista dos itens a mostrar. Um item que você deixa de fora some:

```jsonc
{ "statusBarItems": ["commandBar", "cursorPosition", "problems", "export", "settings"] }
```

Com essa lista a barra fica com o botão da barra de comandos, a posição do cursor, a contagem de problemas e os botões de exportar e de configurações, e perde o resto — os botões das áreas, o nome do template, os botões da fila e dos plugins. Cada item fica do seu lado da barra — o botão da barra de comandos à esquerda; a posição do cursor, os problemas, exportar e configurações à direita — e a ordem da lista é a ordem deles dentro daquele lado. A página da configuração lista o nome de cada item.

## Cores

[`statusBarColors`](../reference/settings.md#statusbarcolors) dá à barra cores próprias, por cima do tema em uso: o fundo e o texto, um botão sob o ponteiro, um botão ligado, o texto de cada item, e as cores do selo de modo do vim.

```jsonc
{ "statusBarColors": { "background": "#204060" } }
```

Uma cor que deixa o texto da barra difícil de ler em algum dos seus temas vale mesmo assim, e o painel de Problemas avisa com `W_SETTING_LOW_CONTRAST`, citando o tema e o contraste que mediu.

Como o modo do vim aparece — um selo colorido, uma faixa colorida no alto da barra, ou a barra inteira na cor do modo — é a configuração [`vimModeStyle`](../reference/settings.md#vimmodestyle). [Modo vim](../editor/vim-mode.md) diz quando o selo aparece.
