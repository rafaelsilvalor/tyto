# Pasta de trabalho

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-21 num build de desenvolvimento do Tyto no Windows 11, numa pasta com um `.tyto/project.json`, um template em `tpl/`, uma imagem em `art/` e dois briefs em `briefs/`, e numa segunda pasta cujos `assets` levavam para fora dela. Os menus e rótulos abaixo são os da janela em português.
:::

Uma pasta de trabalho é uma pasta de projeto com um `.tyto/project.json` dentro. O arquivo diz onde o projeto guarda seus templates, imagens e fontes, e para onde vão as exportações:

```jsonc
{
  "templates": ["tpl"],
  "assets": ["art"],
  "fonts": ["fonts"],
  "output": "exports",
}
```

Toda chave é opcional, e o arquivo também: uma pasta sem ele abre sem nada declarado. Os caminhos são relativos à pasta.

## Abrir e fechar

**Arquivo ▸ Abrir pasta…** escolhe a pasta. Há uma pasta aberta por janela, e ela volta aberta na próxima vez que o Tyto abrir. **Arquivo ▸ Fechar pasta** fecha. Com uma pasta aberta, a barra de título mostra o nome dela entre o arquivo e o app: `logo.brief — promo — Tyto`.

Enquanto ela está aberta:

- os templates dela aparecem ao lado dos seus e dos internos, depois da [sua pasta de templates](../templates/templates-folder.md);
- um brief **dentro da pasta** procura imagens nas pastas `assets` dela depois da própria pasta e da `assets/` ao lado dele, e desenha com as `fonts` dela antes das instaladas neste computador;
- **Exportar…** aponta para a pasta `output` dela até você escolher outra.

Um brief fora da pasta funciona como sempre funcionou.

## Uma pasta em que você ainda não confiou

Toda pasta começa sem confiança. Uma pasta assim abre, mostra a prévia e exporta, mas toda pasta que o arquivo do projeto nomeia precisa estar dentro dela: um nome que leva para fora — `../shared`, um caminho absoluto, ou um atalho dentro da pasta que aponta para outro lugar — fica de fora. Cada um que fica de fora aparece no painel **Problemas** como `W_PROJECT_PATH_OUTSIDE`, com linha e coluna no `.tyto/project.json`. As seções de plugin dela também ficam retidas.

Quando algo fica de fora, uma faixa acima do editor avisa, com dois botões: **Confiar nesta pasta** confia nela e aplica na hora o que tinha ficado de fora, e **Mostrar problemas** abre o painel Problemas. Uma pasta cujos nomes ficam todos dentro dela nunca mostra a faixa.

## Gerenciar confiança

**Pasta de trabalho: gerenciar confiança**, na barra de comandos, mostra a pasta aberta e se ela é confiável, com **Confiar** e **Retirar confiança**. Retirar a confiança vale na próxima vez que a pasta for aberta; até lá ela fica como está.

As pastas em que você confia ficam listadas no `trust.json` da sua pasta do Tyto (`~/.tyto`). Na linha de comando, `tyto trust remove <pasta>` desfaz uma confiança; [Renderizar um brief](../command-line/render.md) tem o resto.
