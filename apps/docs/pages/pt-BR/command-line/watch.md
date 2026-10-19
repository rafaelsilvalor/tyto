# Vigiar uma pasta

::: info Como esta página foi conferida
Cada comando foi executado em 2026-10-19 num build do repositório no commit `b039537` (CLI 0.4.1) no Windows 11. As saídas abaixo foram copiadas dessas execuções.
:::

`tyto watch` é a [pasta da fila](../export/queue-folder.md) sem a janela: ele renderiza cada tarefa que chega na `inbox` de uma pasta, e continua até você pará-lo. Serve para um computador que renderiza para outras pessoas — um servidor, ou uma máquina que fica ligada.

A pasta segue o arranjo da fila da janela: uma tarefa é uma pasta em `inbox/` com um `brief.brief`, os arquivos vão para `outbox/<tarefa>/out/`, e a tarefa vai para `done/`.

## Renderizar o que está lá e parar

`--once` trata as tarefas que já estão na caixa de entrada e sai, que é o que uma tarefa agendada quer:

```
$ tyto watch queue --once
open-day: ok — 8 of 8 artifact(s)
```

Depois, `queue/outbox/open-day/out/` tem as oito imagens e o `result.json`, e `queue/done/open-day/brief.brief` é o brief.

## Continuar vigiando

Sem `--once`, ele olha a caixa de entrada a cada segundo (`--interval` muda isso, em milissegundos) e imprime uma linha para cada tarefa que termina:

```
$ tyto watch queue
second: ok — 8 of 8 artifact(s)
```

Pare com **Ctrl+C**. Mova para dentro de `inbox` uma pasta de tarefa já pronta, em vez de escrever o brief lá dentro, para que um brief pela metade nunca seja lido.

`--types`, `--scale`, `--quality`, `--templates` e `--formats-file` funcionam como no [`tyto render`](./render.md); cada opção está no [`tyto watch`](../reference/command-line.md#tyto-watch) da Referência.
