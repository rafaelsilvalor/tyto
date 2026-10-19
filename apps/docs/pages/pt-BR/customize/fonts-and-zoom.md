# Fontes e zoom

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `b039537`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

## Aumentar tudo: zoom

**Aumentar zoom** (**Ctrl+=**), **Diminuir zoom** (**Ctrl+-**) e **Redefinir zoom** (**Ctrl+0**) aumentam ou diminuem a janela inteira — texto, botões, painéis — em passos. Eles também estão no menu **Exibir**. O zoom fica guardado na configuração [`zoom`](../reference/settings.md#zoom), então a janela abre do mesmo tamanho na próxima vez; **Redefinir zoom** tira a configuração de novo.

## Mudar o tamanho das letras

Duas configurações no `settings.json` definem o tamanho base do texto, em pixels:

- [`codeFontSize`](../reference/settings.md#codefontsize) — o texto que você escreve: briefs, `settings.json`, templates.
- [`uiFontSize`](../reference/settings.md#uifontsize) — todo o resto: menus, abas, painéis, a barra de status.

```jsonc
{
  "codeFontSize": 20,
  "uiFontSize": 15,
}
```

## Só uma parte da janela

[`fontSizes`](../reference/settings.md#fontsizes) define um tamanho para uma **área** da janela e deixa o resto no tamanho base:

```jsonc
{ "fontSizes": { "problems": 16, "statusBar": 13 } }
```

As áreas são o editor, as abas de configuração, a lista de sugestões, o painel de problemas, a barra de comandos, a barra de título, as abas, os cabeçalhos dos painéis, a barra de status e a fila; [`fontSizes`](../reference/settings.md#fontsizes) dá o nome de cada uma.

## Mudar a fonte

[`codeFontFamily`](../reference/settings.md#codefontfamily) e [`uiFontFamily`](../reference/settings.md#uifontfamily) põem uma fonte sua na frente da que vem com o Tyto, e [`fontFamilies`](../reference/settings.md#fontfamilies) faz isso para uma área. Escreva o nome da fonte como o seu computador a conhece.

Uma fonte que o computador não tem aparece no painel de Problemas, e a que vem com o Tyto é desenhada no lugar:

```
W_FONT_FAMILY_MISSING  This font is not installed; the bundled one is drawn instead: fontFamilies.editor "No Such Face"
```

Essas configurações mudam só a janela. As fontes de uma arte são as do template.
