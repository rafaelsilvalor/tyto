# Templates

::: info Como esta página foi conferida
Cada comando foi executado em 2026-10-19 num build do repositório no commit `b039537` (CLI 0.4.1) no Windows 11. As saídas abaixo foram copiadas dessas execuções. **Listar os templates ao alcance** foi executado em 2026-11-15 num build do repositório (CLI 0.12.0 mais esse comando) no Windows 11.
:::

Três comandos ajudam com templates: um lista os que um render pode usar, dois ajudam com os seus próprios. O que vai dentro de um template está no [guia de autoria de templates](../extend/), em inglês; o jeito da janela de editar um é o [Modo template](../editor/template-mode.md).

## Começar um template novo

```
$ tyto template new my-card
templates\my-card\manifest.yaml
templates\my-card\template.html
templates\my-card\examples\my-card.brief
Next: edit template.html, then run 'tyto template check templates\my-card'.
```

Ele grava um template funcionando em `templates/` — a pasta que uma renderização lê — com um brief de exemplo em `examples/`. `--out` o põe em outro lugar, e `--formats grid,story` escolhe os tamanhos com que ele começa (só `grid` se você não disser nada).

## Conferir um template

`tyto template check` lê a pasta de um template como uma renderização leria e diz o que está errado, sem renderizar nada:

```
$ tyto template check templates/my-card
templates\my-card: no problems found
```

Depois de um erro — aqui o manifest pediu um tamanho chamado `nope` que a marcação não desenha:

```
$ tyto template check templates/my-card
templates\my-card\template.html:1:1: error E_TEMPLATE_MARKUP Template markup is invalid: template 'my-card' renders format 'nope' and no frame declares it.
```

O código de saída é `0` para um template limpo e `1` para um com erros, então a conferência pode rodar antes de compartilhar um template. Um template cujo layout é um `template.ts` é conferido até o manifest; o código dele é citado, não executado.

## Listar os templates ao alcance

`tyto template list` mostra cada template que um render na pasta pode usar, um por linha: o nome, de onde ele vem e os tamanhos que ele renderiza.

```
$ tyto template list
banner-teste     built-in   banner, banner-1x1, banner-345x146
carrossel-lista  built-in   grid-1x1, story
meu-cartaz       workspace  grid-1x1, story
promo-curso      built-in   grid-1x1, story
```

- **built-in** vem com o Tyto; **workspace** está no `templates/` da pasta ou numa pasta de templates que o [workspace](../editor/workspace-folder.md) nomeia; **plugin** e um nome vêm de um plugin instalado ou dos arquivos de plugin.
- Um apelido de template é uma linha própria, `nome → template`, com os tamanhos que a configuração dele permite.
- Ele lê os templates exatamente como o `tyto render` lê naquela pasta: um nome listado é um que o `template:` de um brief pode usar, e um nome que fica de fora é um que o render recusa.
- Dê uma pasta para listar o que um render nela usaria: `tyto template list entregas`. `--json` mostra as mesmas linhas como um documento só.
- Numa [pasta em que você não confiou](../editor/workspace-folder.md#uma-pasta-em-que-voce-ainda-nao-confiou) os arquivos de plugin do projeto ficam de fora, como ficam para um render, e uma linha na saída de erro diz isso. `--trust` confia na pasta só nesta execução.
- Como um render, ele baixa o template de um arquivo de plugin na primeira vez em que ele falta. `--no-sync` não baixa nada: um arquivo de plugin cuja cópia ainda não está neste computador fica de fora, e uma linha na saída de erro diz qual. A aba Comandos completa o `--template` assim, então digitar nunca chega à rede.
