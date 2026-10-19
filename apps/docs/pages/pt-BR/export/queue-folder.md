# A pasta da fila

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

A **fila local** renderiza briefs que chegam numa pasta, sem abri-los. Outro programa — ou você, à mão — deixa um brief na pasta, e o Tyto grava os arquivos ao lado. Ela funciona enquanto a janela está aberta.

## Configurar

1. Abra a fila: **Mostrar a fila local** na barra de comandos, ou o botão da fila na barra de status. Ela abre na área esquerda.
2. Clique no botão de pasta no cabeçalho do painel (**Escolher pasta…**) e escolha uma pasta vazia. O Tyto cria uma pasta `inbox` dentro dela, e o painel mostra o caminho embaixo de **Coloque as pastas de tarefa em**.
3. Em **Gera:**, marque os tipos de arquivo que a fila deve gravar. De início só PNG vem marcado.
4. Marque **Renderizar automaticamente** para renderizar cada tarefa assim que ela chega. Deixe desmarcado para renderizar cada uma pelo botão **Renderizar** dela.

As escolhas ficam no [`settings.json`](../reference/settings.md): a pasta em [`queueFolder`](../reference/settings.md#queuefolder), **Renderizar automaticamente** em [`queueAutoRun`](../reference/settings.md#queueautorun), e os tipos de arquivo em [`queueKinds`](../reference/settings.md#queuekinds), uma lista por pasta de fila. **Esquecer pasta** para de vigiá-la.

## Acrescentar uma tarefa

Uma **tarefa** é uma pasta dentro de `inbox` com um arquivo chamado exatamente `brief.brief`:

```
fila/
  inbox/
    dia-aberto/
      brief.brief
      assets/        (opcional: imagens que o brief usa)
```

Monte a pasta em outro lugar e mova-a para dentro de `inbox` quando o brief estiver escrito, para o Tyto nunca ler meio arquivo. Uma imagem que o brief cita é procurada primeiro ao lado do brief, depois em `assets/`.

A tarefa aparece no painel como **pendente**, com **Renderizar** e **Abrir brief**; com **Renderizar automaticamente** ligado ela começa sozinha.

## O que ela grava

Quando uma tarefa termina:

```
fila/
  outbox/
    dia-aberto/
      out/
        grid-01.png
        result.json
  done/
    dia-aberto/
      brief.brief
```

- `outbox/<tarefa>/out/` guarda os arquivos, com os nomes de [Exportar](./index.md#o-que-e-gravado), e o `result.json`, que lista cada arquivo e cada problema.
- A pasta da tarefa sai de `inbox` e vai para `done`, para não ser renderizada duas vezes e o brief nunca ser apagado.

O painel marca a tarefa como **pronta** e oferece **Abrir pasta out/**.

A referência de [Configurações](../reference/settings.md) lista as três chaves com os tipos e os valores padrão.
