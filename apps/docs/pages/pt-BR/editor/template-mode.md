# Modo template

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-19 numa versão de desenvolvimento do Tyto 0.7.0 (commit `e3d32e9`) no Windows 11, uma vez com a janela em inglês e outra em português do Brasil. Os menus e rótulos abaixo são os da janela em português.
:::

O modo template edita os dois arquivos de um template — `manifest.yaml` e `template.html` — ao lado de um desenho de cada formato que o template tem, redesenhado enquanto você digita. Ele cobre a janela; as abas dos seus briefs continuam abertas por trás.

Ele funciona com templates escritos como `manifest.yaml` e `template.html`. Um template cujo layout é um `template.ts` abre como um aviso dizendo que não pode ser editado ali. O que vai nos dois arquivos está no [guia de autoria de templates](../extend/), em inglês; esta página trata da janela.

## Abrir um template

- **Editar template…** (barra de comandos ou menu **Arquivo**) pede a pasta de um template e a abre.
- **Novo template…** abre o modo com o cursor no campo **Nome do novo template**. Digite um nome e clique em **Criar**: o Tyto grava um template funcionando com esse nome na sua [pasta de templates](../templates/templates-folder.md) — os dois arquivos e uma pasta `examples` com um brief para ele — e o abre.

Dentro do modo, **Abrir outro…** troca para outra pasta, e o campo de nome com **Criar** faz mais um template novo.

## Editar e ver

1. Clique em **manifest.yaml** ou **template.html** acima do editor para trocar de arquivo. Um ponto depois do nome de um arquivo quer dizer que ele tem alterações não salvas.
2. Digite. O lado direito redesenha cada formato que o template declara, cada um com o nome e o tamanho.
3. Os problemas dos dois arquivos aparecem embaixo do editor.

O desenho precisa de um **brief de exemplo**: um arquivo `.brief` numa pasta `examples` dentro da pasta do template. Com mais de um, a lista **Brief de exemplo** escolhe qual desenhar. Sem nenhum, o lado direito diz _Nenhum brief em examples/ — a prévia precisa de um._ — acrescente um e use **Abrir outro…** para abrir a pasta de novo.

## Salvar e fechar

**Salvar** grava os dois arquivos. Todo brief aberto na janela que usa esse template é conferido e desenhado de novo na hora: um erro no template aparece no painel de Problemas daquele brief, e a prévia dele mantém o último desenho que funcionou até o template ser corrigido.

**Fechar** volta para os seus briefs. Se algum dos arquivos tiver alterações não salvas, o Tyto pergunta antes: **Continuar editando** ou **Descartar**.

A janela lembra um modo template aberto de um reinício para o outro, como lembra as abas.
