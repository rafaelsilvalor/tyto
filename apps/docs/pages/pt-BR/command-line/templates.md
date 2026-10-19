# Templates

::: info Como esta página foi conferida
Cada comando foi executado em 2026-10-19 num build do repositório no commit `b039537` (CLI 0.4.1) no Windows 11. As saídas abaixo foram copiadas dessas execuções.
:::

Dois comandos ajudam com os seus próprios templates. O que vai dentro de um template está no [guia de autoria de templates](../extend/), em inglês; o jeito da janela de editar um é o [Modo template](../editor/template-mode.md).

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
