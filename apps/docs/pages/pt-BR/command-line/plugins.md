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

## Buscar templates nos seus próprios repositórios

Um **arquivo de plugin** diz de que repositório buscar um plugin ou os seus templates, e qual versão. Os da máquina ficam em `~/.tyto/plugin-files`; os de um projeto ficam em `.tyto/plugin-files` ao lado dos briefs, e só contam depois que a pasta é de confiança. A entrada de um template no projeto vence a da máquina.

<!-- Os comandos desta seção foram executados em 2026-10-29 num build da branch feat/TYTO-432-plugin-files-sync, no Windows 11, com TYTO_HOME apontando para uma pasta vazia e o pacote de exemplo num repositório duas pastas acima, com a tag v1.0.0. -->

```yaml
# ~/.tyto/plugin-files/avisos.yaml
version: 1
templates:
  aviso:
    source:
      git: ../../my-pack # qualquer endereço que o seu git leia: https://…/repo.git, git@…, uma pasta
      ref: v1.0.0 # uma tag, uma branch ou um commit completo
```

Uma pasta que começa com `./` ou `../` é lida a partir da pasta do próprio arquivo de plugin. `tyto plugin sync` busca cada origem com o seu próprio `git` — as suas credenciais, chaves SSH e proxy, nada guardado pelo Tyto — e grava o commit que obteve em `plugin-files.lock.json`, ao lado dos arquivos:

```
$ tyto plugin sync
example-pack  ../../my-pack  v1.0.0  c50a1231d0be  home\plugin-files\avisos.yaml
```

**`tyto render` faz o mesmo antes de renderizar**, então um render só usa a rede quando falta uma cópia, na primeira vez, e no resto usa o que já está neste computador. Ele nunca move o que o lock fixou: uma branch que alguém atualizou fica onde o lock diz até você rodar `tyto plugin sync --update`. O lock de um projeto vai para o controle de versão dele, para todo mundo renderizar o mesmo commit. `tyto watch` nunca busca nada.

Sem rede, a cópia buscada antes é usada, e a execução avisa:

```
$ tyto plugin sync --update
example-pack  ../../my-pack  v1.0.0  c50a1231d0be  home\plugin-files\avisos.yaml
warning W_PLUGIN_FILE_FETCH Could not fetch '../../my-pack' at 'v1.0.0': fatal: 'C:\Users\rafae\AppData\Local\Temp\t432\my-pack' does not appear to be a git repository. The copy of commit c50a1231d0be435c0717c2fd89715f2a68d755f6 fetched earlier loads.
```

Um template tirado dos arquivos para de carregar na hora; a cópia dele fica até `tyto plugin clean` apagar as cópias que nenhum lock cita:

```
$ tyto plugin clean
home\cache\plugin-files\94529b5cf90e68c9814015bbcf2aac31f959747fb4e294710d4d3dfcc98b0fc3\c50a1231d0be435c0717c2fd89715f2a68d755f6
Removed 1 cached copy.
```

Um plugin buscado que pede permissões é mostrado e perguntado por `tyto plugin sync`, como o `install` faz, ou aprovado com `--yes`; um render nunca pergunta, e pula o que ninguém aprovou.

`tyto plugin list` mostra o que os arquivos de plugins nomeiam abaixo dos plugins instalados: o plugin, se o arquivo é da máquina ou do projeto, a fonte, a ref, o commit que o lock fixa e se um render o carrega (`approved`, aprovado; `not approved`, sem aprovação; `not synced`, antes da primeira sincronização; `refused`, quando o commit não é um plugin que este Tyto consegue carregar). Depois vem cada apelido, com o template e a configuração a que ele leva. Ele lê só o que está neste computador: não busca nada e não roda nenhum plugin.

```
$ tyto plugin list
…
plugin files:
example-pack  machine  ../../my-pack  v1.0.0  c50a1231d0be  approved  home\plugin-files\avisos.yaml

aliases:
aviso-laranja → aviso (laranja)  home\plugin-files\avisos.yaml
```

Numa pasta que não é confiável, os arquivos de plugins do projeto não são carregados nem listados, e `tyto render` e `tyto plugin list` avisam isso numa linha que nomeia `.tyto/plugin-files`.

### Configurações e apelidos

Um pacote buscado oferece só os templates que o arquivo cita. Cada template pode ter **configurações** com nome, que mudam os valores que o template declara que deixa mudar, como uma cor, um tamanho, uma fonte ou uma imagem. Um brief chega a uma configuração pelo **apelido**: escreva `alias:` para escolher o apelido, ou deixe de fora e o apelido é o nome do template, um traço e o nome da configuração. `default:` diz qual configuração um brief recebe quando escreve o nome do próprio template, e toda outra configuração parte dessa e muda só o que lista. O caminho de uma imagem é lido a partir da pasta do próprio arquivo de plugin e precisa ficar dentro do projeto, ou dentro de `~/.tyto` nos arquivos da máquina.

```yaml
# ~/.tyto/plugin-files/avisos.yaml
version: 1
templates:
  aviso:
    source:
      git: ../../../my-pack
      ref: v1.0.0
    configurations:
      laranja: # um brief escreve `template: aviso-laranja`
        values:
          paper: '#ffffff'
```

<!-- Executado em 2026-10-29 num build da branch feat/TYTO-439-configurations-and-aliases, no Windows 11, com TYTO_HOME=home e o pacote de exemplo num repositório três pastas acima do arquivo, com a tag v1.0.0. -->

Um valor que o template não declara, ou que passa dos limites dele, é um aviso na linha que o escreveu, e o valor do próprio template continua:

```
$ tyto render aviso.brief --out out --types svg
home\plugin-files\avisos.yaml:10:18: warning W_TEMPLATE_VALUE_UNKNOWN Template 'aviso' declares no configurable value 'paper'; the setting is ignored.
```

Um apelido nunca pode ser o nome de um template: `E_TEMPLATE_ALIAS_TAKEN` aponta para ele, o apelido não carrega, e o template com esse nome renderiza como antes. O mesmo apelido em dois arquivos de uma pasta não carrega de nenhum dos dois, e o apelido do projeto vence o da máquina.

## Começar o seu

`tyto plugin new my-pack` grava uma pasta de plugin com um template dentro, pronta para instalar; o [guia de autoria de plugins](../extend/) continua dali. Cada opção de cada comando `plugin` está na [Linha de comando](../reference/command-line.md#tyto-plugin-list) da Referência.
