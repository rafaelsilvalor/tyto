# Temas

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `b039537`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

Um **tema de cores** pinta a janela e o editor. Até você escolher um, o Tyto acompanha o computador: Tyto Light enquanto o sistema está claro, Tyto Dark enquanto está escuro.

## Escolher um tema

1. Execute **Preferências: Tema de cores** pela barra de comandos.
2. Passe pela lista com as setas, ou digite parte de um nome. A janela assume cada tema quando você chega nele, então você o vê antes de escolher.
3. Aperte **Enter** para ficar com ele, ou **Esc** para voltar ao tema que você tinha.

O **Enter** grava a escolha na configuração [`theme`](../reference/settings.md#theme) do `settings.json`. Alguns temas aparecem duas vezes — com as cores originais dos autores, e _ajustados_ para que todo texto tenha um contraste mínimo. [Temas](../reference/themes.md) lista todos.

## Um tema para o claro, outro para o escuro

Para continuar acompanhando o computador com temas seus, escreva a configuração à mão:

```jsonc
{ "theme": { "mode": "system", "light": "solarized-light-adjusted", "dark": "nord-adjusted" } }
```

`"mode": "light"` ou `"dark"` fica com um dos dois, diga o computador o que disser.

## Temas de um plugin

Um plugin pode trazer mais temas. Instale-o — `tyto plugin install <pasta>`, veja [Plugins](./plugins.md) — e abra a janela de novo: os temas dele aparecem em **Preferências: Tema de cores** junto com os outros. Desligue o plugin e eles saem da lista.

Fazer um tema está no [guia de autoria de plugins](../extend/), em inglês.
