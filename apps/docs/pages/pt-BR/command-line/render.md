# Renderizar um brief

::: info Como esta página foi conferida
Cada comando foi executado em 2026-10-19 num build do repositório no commit `b039537` (CLI 0.4.1) no Windows 11, numa pasta com `formats.yaml`, uma pasta `templates/notice` e o `carousel.brief` do manual. As saídas abaixo foram copiadas dessas execuções.
:::

`tyto render` transforma um brief em arquivos numa pasta — os mesmos arquivos que [Exportar](../export/) faz na janela.

```
$ tyto render carousel.brief --out out
grid-01.png
story-01.png
grid-02.png
story-02.png
grid-03.png
story-03.png
grid-04.png
story-04.png
```

Ele imprime cada arquivo à medida que grava. Depois, `out/` tem as oito imagens e um `result.json` que as lista. `--out` é obrigatório, a não ser que o brief esteja numa pasta de trabalho cujo arquivo de projeto diga uma pasta de saída (abaixo).

## Escolher tipos de arquivo, escala e qualidade

`--types` aceita um ou mais de `png`, `jpeg`, `webp` e `svg`, separados por vírgula; só PNG se você não disser nada. `--scale 2` dobra os pixels das imagens, e `--quality` (1 a 100) vale só para JPEG e WebP, como na janela — veja [Imagens](../export/images.md).

```
$ tyto render carousel.brief --out out2 --types svg,webp --scale 2 --quality 80
grid-01.svg
grid-01.webp
story-01.svg
story-01.webp
```

(As quatro primeiras linhas de dezesseis.)

## Gravar numa pasta própria

`--folder` põe os arquivos numa subpasta com o nome do brief, sem nada ao lado — nem `result.json`, nem cópia do brief, nem imagens —, como faz a exportação da janela. O relatório da execução é o que o comando imprime, e `--json` o imprime como um só documento:

```
deliveries/
  carousel/
    grid-01.png
    grid-02.png
    …
```

Um arquivo que já está lá com o mesmo nome é substituído, e todos os outros ficam como estão.

## Renderizar dentro de uma pasta de trabalho

Uma pasta de trabalho é uma pasta de projeto com um `.tyto/project.json` dentro. O arquivo diz onde o projeto guarda seus templates, imagens e fontes, e para onde vão as exportações:

```jsonc
{
  // where this project keeps its things
  "templates": ["tpl"],
  "assets": ["art"],
  "output": "exports",
}
```

O `tyto render` procura esse arquivo na pasta do brief e em cada pasta acima dela, então um brief em qualquer lugar do projeto o usa sem você digitar nada. Os comandos abaixo foram executados em 2026-10-21 numa pasta assim, com o brief em `briefs/`, o template em `tpl/` e a imagem em `art/`:

```
$ tyto render briefs/cartaz.brief --types svg
feed-01.svg
feed-02.svg
```

Os arquivos foram para `exports/`. Um `--out` que você digitar continua valendo mais, e `--templates` também. Caminhos de imagem são procurados primeiro ao lado do brief, depois em `assets/` ao lado dele, depois nas pastas `assets` do projeto.

### Uma pasta em que você ainda não confiou

Até você confiar numa pasta de trabalho, toda pasta que o arquivo do projeto nomeia precisa estar dentro dela. Um nome que leva para fora — `../shared/exports`, um caminho absoluto, ou um atalho dentro da pasta que aponta para outro lugar — fica de fora e é impresso:

```
$ tyto render briefs/cartaz.brief --types svg
.tyto\project.json:4:13: warning W_PROJECT_PATH_OUTSIDE Project key 'output' leads outside this folder ('../shared/exports'), which an untrusted folder may not do; it is left out.
error: --out is required: .tyto\project.json declares no output folder this run may use
```

`--trust` confia na pasta só naquela execução e não anota nada. Para confiar de vez, rode `tyto trust add <pasta>`: ele primeiro imprime o que a pasta faz enquanto não tem confiança e depois anota a aprovação, sem pergunta para responder, então um script também pode rodá-lo. Uma pasta sem `.tyto/project.json` também pode receber confiança.

Executado em 2026-10-22 numa pasta cujo arquivo do projeto cita `../shared/exports` e `../team/saude.json` (o caminho da pasta encurtado para `D:\work\campanha`):

```
$ tyto trust add .
.tyto\project.json:3:13: warning W_PROJECT_PATH_OUTSIDE Project key 'output' leads outside this folder ('../shared/exports'), which an untrusted folder may not do; it is left out.
.tyto\project.json:4:14: warning W_PROJECT_PATH_OUTSIDE Project key 'profile' leads outside this folder ('../team/saude.json'), which an untrusted folder may not do; it is left out.
Above: what this folder does while restricted; trusting it lifts that.
Trusted: D:\work\campanha (since 2026-10-22)
It names the work profile D:\work\team\saude.json, which is trusted on its own (ADR 0114): tyto trust add "D:\work\team\saude.json"

$ tyto trust list
D:\work\campanha  since 2026-10-22
Take one back with tyto trust remove <path>.
```

`tyto trust list` imprime todas as pastas e arquivos de perfil em que você confia, com o dia em que confiou, e marca com `(missing)` o que não existe mais. `tyto trust remove <pasta>` desfaz uma confiança dada antes. Os dois leem e gravam o `trust.json` da sua pasta do Tyto (`~/.tyto`), o mesmo arquivo que o app de mesa grava quando você confia numa pasta por lá. A própria pasta do Tyto não pode receber confiança como projeto: ela guarda seus plugins e o `trust.json`, não o conteúdo de um projeto.

### Uma ficha para várias pastas: perfis de trabalho

Quando várias pastas de projeto guardam suas coisas nos mesmos lugares — os templates, as imagens, as fontes e a pasta de saída de uma vertical — escreva esses lugares uma vez num **perfil de trabalho** e deixe cada pasta citá-lo. Guarde o perfil na sua pasta do Tyto, uma pasta por perfil:

```jsonc
// ~/.tyto/profiles/saude/profile.json
{
  "templates": ["tpl"],
  "assets": ["art"],
  "output": "../../../exports",
}
```

Um perfil aceita as mesmas chaves de um arquivo de projeto, e as pastas relativas dele são lidas a partir da pasta do próprio perfil, então o `tpl` acima é `~/.tyto/profiles/saude/tpl` para todo projeto que o usa. O arquivo do projeto cita o perfil e escreve só o que muda:

```jsonc
// campanha-a/.tyto/project.json
{ "profile": "saude" }
```

```jsonc
// campanha-b/.tyto/project.json
{
  "profile": "saude",
  "output": "out",
}
```

Executado em 2026-10-21, sem template nem imagem em nenhuma das duas pastas:

```
$ tyto render briefs/cartaz.brief --types svg
feed-01.svg
feed-02.svg
```

De `campanha-a` os arquivos foram para o `exports/` do perfil; de `campanha-b` foram para o `out/` dela. Uma chave que a pasta escreve substitui a do perfil por inteiro — uma pasta que escreve `fonts` usa aquelas fontes e nenhuma do perfil — e uma chave que ela não escreve vem do perfil.

O nome de um perfil é um nome de pasta comum: letras, números, espaços e acentos podem, mas barra, ponto no começo ou `..` não. Um nome que não está em `~/.tyto/profiles/` sai como `W_PROJECT_PROFILE_MISSING`, e a pasta renderiza com as chaves dela.

**Um perfil compartilhado pela equipe** é um arquivo citado pelo caminho, como `"profile": "../team/saude.json"`, ou uma pasta com um `profile.json` dentro. Como outra pessoa pode editá-lo, ele recebe confiança por conta própria, nunca porque a pasta que o cita recebeu: até você confiar nesse arquivo com `tyto trust add <arquivo>`, as pastas dele precisam ficar dentro da pasta dele, e `tyto trust remove <arquivo>` desfaz essa confiança. O `tyto trust add <pasta>` diz qual arquivo confiar quando a pasta cita um. Um perfil em `~/.tyto/profiles/` já tem confiança, por causa de onde fica. Uma pasta em que você ainda não confiou só pode citar um arquivo de perfil que esteja dentro dela:

```
$ tyto render briefs/cartaz.brief --types svg
.tyto\project.json:2:14: warning W_PROJECT_PATH_OUTSIDE Project key 'profile' leads outside this folder ('../team/saude.json'), which an untrusted folder may not do; it is left out.
```

O `--trust` vale para a pasta e para o perfil que ela cita, só naquela execução.

## Gerar o gabarito da arte pintada fora

Alguns templates deixam uma imagem para ser pintada em outro programa, como um fundo ou uma ilustração, e dizem isso no manifesto. Enquanto esse arquivo não existe, a renderização desenha uma caixa magenta contornada no lugar dela. O `--guide` grava, em vez das imagens, um **PSD** em camadas para quem vai pintar: um por tamanho da peça e um por tamanho de cada imagem que fica no meio do texto. Conferido em 19/11/2026 com o brief de exemplo do template embutido `arte-teste`, num build de desenvolvimento do CLI:

```
$ tyto render sem-arte.brief --guide --out guide
sem-arte.brief:1:1: warning W_EXTERNAL_ART_MISSING Slot 'fundo' of template 'arte-teste' has no art yet (the brief names no file); an outlined box is drawn where it goes.
sem-arte.brief:1:1: warning W_EXTERNAL_ART_MISSING Slot 'imagem' of template 'arte-teste' has no art yet (the brief names no file); an outlined box is drawn where it goes.
artwork-1-grid-1x1.psd
artwork-1-story.psd
imagem-grid-1x1.psd
imagem-story.psd
```

- **A peça**, `<arte>-<tamanho>.psd`, tem o tamanho do formato e quatro camadas, de cima para baixo: `texto` (tudo o que fica acima da arte, travada), `areas` (a caixa de cada slot, contornada e com o nome, travada, com metade da opacidade), `arte` (vazia: pinte aqui) e `decoracao` (o fundo e o que fica sob a arte, oculta e travada).
- **Uma imagem no meio do texto**, `<slot>-<tamanho>.psd`, tem a largura que o template declara para aquele tamanho e a altura que ele sugere, com uma camada vazia cujo nome traz a largura, como `arte 920px`. Mude a altura se a imagem pedir; mantenha a largura.

O `--guide` decide o tipo de arquivo, então não se combina com `--types`, e `--types psd` sozinho é recusado. Um brief cujo template não declara imagem assim não grava gabarito:

```
$ tyto render promo.brief --guide --out guide
promo.brief: error E_GUIDE_NO_EXTERNAL_ART Template 'promo-curso' declares no slot with external art, so there is no guide to write: a guide is for a slot whose manifest declares 'external'.
```

## Gravar cada gabarito ao lado da arte: `tyto guide`

O `tyto render --guide` grava numa pasta de saída. O `tyto guide <brief>` grava cada gabarito **ao lado do arquivo que o brief cita para aquela arte**, com o nome dele, para que a imagem pintada a partir dele caia onde o brief a lê de volta. Um brief que cita `fundo: fundo.png` e renderiza dois tamanhos ganha `fundo.grid-1x1.guide.psd` e `fundo.story.guide.psd`; salve cada pintura como `fundo.grid-1x1.png` e `fundo.story.png` na mesma pasta, e cada tamanho desenha a sua. Com um tamanho só, o gabarito é `fundo.guide.psd` e a pintura é o próprio `fundo.png`. A pasta é a `assets/` ao lado do brief (a `assets/` da entrega, para um brief numa entrega), ou a pasta onde o arquivo citado já está, quando ele está ao lado do brief. Conferido em 19/11/2026 com o template embutido `arte-teste`, num build de desenvolvimento do CLI:

```
$ tyto guide arte.brief --list
fundo (full): fundo.png, line 4
  grid-1x1: guide assetsundo.grid-1x1.guide.psd missing; art assetsundo.grid-1x1.png missing
  story: guide assetsundo.story.guide.psd missing; art assetsundo.story.png missing
imagem (inline): not cited; add "imagem: imagem.png" to the brief
$ tyto guide arte.brief
assetsundo.grid-1x1.guide.psd
assetsundo.story.guide.psd
```

O `--list` não grava nada: mostra cada arquivo citado, os gabaritos dele e se cada um existe, e a arte para a qual o brief não cita arquivo, com a linha que citaria um. Essa arte não ganha gabarito até o brief dar o nome do arquivo.

Por padrão, só os gabaritos que faltam são gravados; o `--all` grava todos, e o `--only <arquivo>` os gabaritos de um arquivo citado ou de um nome de gabarito. Um gabarito alterado depois do brief pode ter o que alguém pintou, então nunca é sobrescrito sem `--force`; quando um está no caminho, nenhum é gravado:

```
$ tyto guide arte.brief --all
arte.brief: error E_GUIDE_NEWER_THAN_BRIEF The guide 'assetsundo.grid-1x1.guide.psd' was changed after the brief, and may hold the art painted in it: move it away, or pass --force to write it again.
arte.brief: error E_GUIDE_NEWER_THAN_BRIEF The guide 'assetsundo.story.guide.psd' was changed after the brief, and may hold the art painted in it: move it away, or pass --force to write it again.
```

O `--open` abre cada gabarito gravado no programa que o seu computador usa para abrir PSD. O `--formats` e o `--template` funcionam como no `tyto render`.

O brief também pode citar um arquivo que o Tyto não desenha sozinho, como o próprio PSD, depois que um plugin que decodifica esse tipo de arquivo estiver instalado: `fundo: fundo.psd` desenha o arquivo inteiro, e `fundo: fundo.psd#arte` a camada chamada `arte` (uma camada dentro de um grupo é `grupo/arte`). O gabarito de uma camada citada leva o nome do arquivo, `fundo.guide.psd`, nunca o da camada. A imagem que o plugin decodifica fica guardada na sua pasta do Tyto e só é decodificada de novo quando o arquivo ou o plugin muda. Sem esse plugin instalado, a linha do brief diz que tipo de arquivo precisa de um. Numa pasta em que você não confiou, nenhum plugin decodifica nada novo, e a linha diz para confiar na pasta; o `tyto watch` decodifica, porque decodificar só lê um arquivo que já está no seu computador.

## Quando o brief tem erros

Cada problema sai com o arquivo, a linha e a coluna, o código e o que está errado, e o comando termina com código de saída `1`:

```
$ tyto render broken.brief --out out3
broken.brief:1:1: error E_MISSING_REQUIRED_SLOT Template 'notice' requires slot 'titulo', which the brief does not set.
broken.brief:5:3: error E_UNKNOWN_SLOT Unknown slot 'subtitle'. Template 'notice' declares: titulo, subtitulo, imagem, tom, lamina.
    Did you mean 'subtitulo'?
grid-01.png
```

O que ainda deu para desenhar é gravado, como o `grid-01.png` aqui; então confira o código de saída, e não se apareceram arquivos. Com `--json`, a mesma execução imprime `"status": "error"` e cada problema com `code`, `line` e `column`.

## Outras opções

- `--template` diz qual template usar num brief cujo frontmatter não cita nenhum; um brief que cita ganha.
- `--formats` diz quais tamanhos fazer. Num brief com linha `formats:`, escolhe alguns dos tamanhos dessa linha; um tamanho que a linha não tem dá `E_FORMAT_NOT_IN_BRIEF`. Num brief sem a linha, é a lista de tamanhos.
- `--assets` diz onde procurar os caminhos de imagem do brief; por padrão, numa pasta `assets/` ao lado do brief, senão na própria pasta do brief.
- `--section <plugin>.<chave>=<valor>` define, só nesta execução, uma chave da entrada de um plugin em `plugins` no `.tyto/project.json`, por cima do que o arquivo diz, sem mexer no arquivo. Repita para mais chaves. O valor é lido como JSON quando é JSON — `50`, `true`, `["a","b"]` — e, senão, como o texto digitado; escreva `'"42"'` para o texto `42`. Vale também numa pasta sem confiança, em que as entradas de plugin do próprio arquivo continuam retidas: você digitou, então você aprovou. Uma opção fora do formato `<plugin>.<chave>=<valor>` para a execução antes de começar.

O [`tyto render`](../reference/command-line.md#tyto-render) da Referência lista cada opção com o valor padrão.
