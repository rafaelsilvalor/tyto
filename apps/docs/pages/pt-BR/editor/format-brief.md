# Arrumar brief

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

**Arrumar brief** (**Alt+Shift+F**) acerta os espaços do brief da frente sem mudar o que ele diz:

- o texto de cada bloco `::` fica com o mesmo recuo — dois espaços, a não ser que a configuração [`tabSize`](../reference/settings.md#tabsize) diga outra coisa;
- os espaços no fim das linhas são removidos;
- várias linhas em branco seguidas viram uma só.

Por exemplo, este brief:

```
::titulo Open day···



::lamina
      Guided tours
```

vira:

```
::titulo Open day

::lamina
  Guided tours
```

(O `···` representa espaços que não se veem.) As linhas entre os dois `---` ficam como estão.

**Ctrl+Z** desfaz o arrumar inteiro de uma vez.

Um brief com erro de sintaxe — o tipo que o painel de Problemas mostra como `E_SYNTAX` — fica exatamente como está, porque o Tyto não consegue saber onde os blocos dele começam. Corrija o erro e arrume de novo.

## Arrumar toda vez que salvar

Ponha [`formatBriefOnSave`](../reference/settings.md#formatbriefonsave) como `true` no `settings.json` e cada **Salvar** arruma o brief antes. Um brief com erro de sintaxe é salvo como está. [Personalizar](../customize/) explica como abrir e mudar o `settings.json`.
