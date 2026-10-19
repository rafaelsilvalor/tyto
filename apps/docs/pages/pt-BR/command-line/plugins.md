# Plugins

::: info Como esta página foi conferida
Cada comando foi executado em 2026-10-19 num build do repositório no commit `b039537` (CLI 0.4.1) no Windows 11, com `TYTO_HOME` apontando para uma pasta vazia. As saídas abaixo foram copiadas dessas execuções.
:::

Um **plugin** acrescenta coisas ao Tyto: templates, temas de cores, tipos de arquivo e mais. Os comandos `tyto plugin` instalam e cuidam deles, e a janela usa o que eles instalaram — [Plugins](../customize/plugins.md) em Personalizar mostra esse lado. Escrever um está no [guia de autoria de plugins](../extend/), em inglês.

Os plugins instalados ficam em `~/.tyto/plugins` (`%USERPROFILE%\.tyto\plugins` no Windows), compartilhados por todas as versões do aplicativo. A variável de ambiente `TYTO_HOME` muda essa pasta de lugar.

## Instalar

`tyto plugin install` aceita uma pasta, uma URL git ou o nome de um pacote npm. Ele mostra o que o plugin acrescenta e as permissões que pede, e quer a sua aprovação antes de instalar. `--yes` a dá na própria linha de comando; sem ele, uma execução sem ninguém no terminal para responder — um script — para com _Nobody is at a terminal to answer; run again with --yes._

<!-- A pergunta feita num terminal de verdade não foi medida: as execuções do autor não tinham terminal (TYTO-317). -->

```
$ tyto plugin install ./my-pack --yes
my-pack 0.1.0 from ./my-pack
contributes: template-pack
permissions:
  (none)
Each plugin runs in a process of its own, so a crash stops the plugin and not Tyto.
Node's permission model confines that process to the plugin's own folder: it cannot
read your other files, write anywhere, or start programs. It is not confined on the
network: net: permissions filter host.fetch only, and a plugin that opens its own
connection is not stopped. credentials: permissions filter host.credentials.
Installed my-pack 0.1.0.
```

Leia as permissões antes de aprovar: um plugin que não pede nenhuma, como este, não alcança nada fora da própria pasta. Instalar **copia** o plugin, então a pasta de onde você instalou pode ser movida ou apagada depois.

Uma janela que já está aberta inicia o plugin novo na próxima vez que abrir.

## Ver o que está instalado

```
$ tyto plugin list
html                0.4.2  built-in  enabled  exporter
svg                 1.0.2  built-in  enabled  exporter
built-in-templates  0.1.0  built-in  enabled  template-pack
chromium            0.1.0  built-in  enabled  rasterizer
fs-inbox            1.0.3  built-in  enabled  source
fs-outbox           1.0.3  built-in  enabled  sink
my-pack             0.1.0  external  enabled  template-pack
```

Cada linha traz o nome, a versão, de onde veio, se está ligado e o que acrescenta. `--active` lista só os que uma renderização iniciaria.

## Desligar e religar

```
$ tyto plugin disable my-pack
Disabled my-pack.
$ tyto plugin enable my-pack
Enabled my-pack.
```

Um plugin desligado continua instalado e fica fora de toda renderização e da janela, que é o jeito de saber se um problema vem dele.

## Remover

```
$ tyto plugin remove my-pack
Removed my-pack.
```

## Começar o seu

`tyto plugin new my-pack` grava uma pasta de plugin com um template dentro, pronta para instalar; o [guia de autoria de plugins](../extend/) continua dali. Cada opção de cada comando `plugin` está na [Linha de comando](../reference/command-line.md#tyto-plugin-list) da Referência.
