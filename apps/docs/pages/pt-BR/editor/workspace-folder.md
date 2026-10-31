# Pasta de trabalho

::: info Como esta página foi conferida
Cada passo foi seguido em 2026-10-21 num build de desenvolvimento do Tyto no Windows 11, numa pasta com um `.tyto/project.json`, um template em `tpl/`, uma imagem em `art/` e dois briefs em `briefs/`, numa segunda pasta cujos `assets` levavam para fora dela, e no mesmo dia numa pasta que cita um perfil de trabalho guardado em `~/.tyto/profiles/` e numa que cita um arquivo de perfil dentro dela cujos `assets` levavam para fora da pasta do perfil. Os menus e rótulos abaixo são os da janela em português. Os botões do cabeçalho do Explorador foram conferidos em 2026-10-23 num build de desenvolvimento, no tema claro e no escuro. As predefinições de exportação foram conferidas em 2026-10-23 num build de desenvolvimento, pela barra de comandos e por uma tecla ligada no `keybindings.json`. **Entrega: nova…** foi conferida em 2026-10-30 num build de desenvolvimento, na janela em inglês, com um nome recusado, um nome aceito, **Sem template** e um brief que já existia.
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

### Trocar entre pastas recentes

A barra de título tem um botão depois de **Ajuda** com o nome da pasta aberta, ou _Sem pasta_. Clique nele, ou rode **Abrir pasta recente…** na barra de comandos ou no menu **Arquivo**, para ver as pastas que você abriu antes, a mais recente primeiro, com o lugar de cada uma. Digite para filtrar a lista por nome ou lugar, mova com as setas e aperte **Enter** para abrir a pasta destacada; **Esc** fecha a lista. A pasta aberta aparece na lista marcada como _aberta_. **Abrir pasta local…**, no pé da lista, é o **Arquivo ▸ Abrir pasta…**.

Uma pasta escolhida aqui abre exatamente como pelo **Arquivo ▸ Abrir pasta…**: na mesma janela, no lugar da pasta aberta agora, e confiável só se você já tiver confiado nela. A lista guarda as últimas dez pastas, e uma pasta que não está mais no disco fica de fora. O id do comando é `workspace.openRecent`, então o `keybindings.json` pode pô-lo numa tecla.

### Cada pasta guarda as suas abas

Cada pasta lembra as abas que estavam abertas nela, como no Zed. Quando você abre outra pasta, pelo **Arquivo ▸ Abrir pasta…**, pela lista de recentes ou pelo **Arquivo ▸ Fechar pasta**, o Tyto guarda as abas da pasta que você está deixando, recarrega a janela e mostra as abas que a pasta nova tinha quando você saiu dela da última vez. Uma pasta que você ainda não abriu começa sem abas, e a prévia continua ao lado se estava aberta. As abas que você tinha abertas sem pasta são guardadas do mesmo jeito, e voltam quando você fecha a pasta.

O texto não salvo volta também, e nada pergunta antes da troca. Se um arquivo mudou no disco enquanto a pasta dele estava fora, ele abre como está agora e o seu texto não salvo volta numa aba nova ao lado. Um arquivo que sumiu perde a aba, e o painel de problemas avisa. Se o Tyto não conseguiu guardar uma aba com texto não salvo, a pasta não muda e a barra de status avisa: salve a aba e tente de novo.

O Tyto guarda as abas das últimas dez pastas que você deixou, tantas quantas a lista de recentes mostra. O tamanho dos painéis e os terminais são da janela, não da pasta: a troca os deixa como estão.

Enquanto ela está aberta:

- os templates dela aparecem ao lado dos seus e dos internos, depois da [sua pasta de templates](../templates/templates-folder.md);
- um brief **dentro da pasta** procura imagens nas pastas `assets` dela depois da própria pasta e da `assets/` ao lado dele, e desenha com as `fonts` dela antes das instaladas neste computador;
- **Exportar…** aponta para a pasta `output` dela até você escolher outra.

Um brief fora da pasta funciona como sempre funcionou.

## Predefinições de exportação: uma entrega numa tecla

Um arquivo de projeto pode nomear **predefinições de exportação**: um conjunto de tamanhos e tipos de arquivo, e a pasta para onde eles vão, rodado como um comando só.

```jsonc
{
  "output": "exports",
  "exportPresets": {
    "entregas": { "formats": ["grid-1x1", "story"], "folder": "entregas" },
    "web": { "formats": ["story"], "types": ["webp", "png"] },
  },
}
```

- `formats` lista os tamanhos, pelo menos um. Um tamanho que o template do brief não tem é avisado quando a predefinição roda, como a janela Exportar avisa.
- `types` lista os tipos de arquivo — `png`, `jpeg`, `webp`, `svg` — e é `png` quando fica de fora.
- `folder` é para onde vão os arquivos, relativo à pasta aberta. Sem ele a predefinição usa `output`; sem nenhum dos dois, a predefinição fica de fora e **Problemas** diz por quê. A pasta é criada se não existir.

Cada predefinição é um comando na barra de comandos, **Exportar: entregas**, para o brief da frente. Ele abre a janela Exportar já rodando, com a contagem, os problemas e **Abrir pasta** como sempre, e grava o que [Exportar](../export/index.md#o-que-e-gravado) grava: as artes e nada mais. Um arquivo de mesmo nome é substituído, e todos os outros arquivos da pasta ficam como estão.

Para dar uma tecla a uma predefinição, ligue o comando dela no [`keybindings.json`](../customize/keybindings-json.md):

```json
[{ "key": "ctrl+e", "command": "export.preset:entregas" }]
```

Um perfil de trabalho também pode ter predefinições. Uma pasta que define uma predefinição com o mesmo nome substitui essa e mantém as outras do perfil. O `folder` de um perfil continua relativo à pasta aberta, então `"folder": "entregas"` é a `entregas` de cada campanha. Numa pasta em que você ainda não confiou, o `folder` de uma predefinição precisa ficar dentro dela: um que leva para fora aparece como `W_PROJECT_PATH_OUTSIDE` e essa predefinição fica de fora.

## Entregas: uma pasta por peça de trabalho

Uma **entrega** é uma pasta para uma peça de trabalho, com o nome do card, `assets/` e `editaveis/` dentro e o brief em `editaveis/`.

**Arquivo ▸ Entrega: nova…**, ou o mesmo comando na barra de comandos, cria uma na pasta aberta. A barra pergunta o nome e diz, enquanto você digita, por que um nome não pode ser de uma pasta — um `:` ou uma `/`, por exemplo —, e o Enter não faz nada até poder. Depois ela lista os templates, como **Novo brief a partir de template…**, com **Sem template** primeiro. O brief da entrega abre numa aba nova e fica selecionado no Explorador: com um template, ele traz o esqueleto do template; sem nenhum, abre com o menu "/", onde escolher um template escreve o esqueleto dele. Um brief que já existe nunca é sobrescrito: a barra de status diz por que nada foi criado, e nada é escrito. O comando fica cinza enquanto nenhuma pasta está aberta, e pode ganhar uma tecla no [`keybindings.json`](../customize/keybindings-json.md) como `delivery.new`. [`tyto delivery new`](../command-line/deliveries.md) faz o mesmo pela linha de comando.

**Exportar a entrega**: com o brief de uma entrega na frente, o botão ao lado de **Abrir a prévia ao lado**, na ponta direita da faixa de abas, exporta sem caixa para preencher. A janela Exportar abre já rodando, como numa predefinição. As artes vão para a raiz da entrega (a pasta `exports` dela), e o `result.json` e o `template.txt` vão para `editaveis/`, ao lado do brief; o brief fica como está, e cada imagem que ele usa de fora de `assets/` é copiada para lá, nunca por cima de um arquivo seu ([Exportar uma entrega](../command-line/deliveries.md#exportar-uma-entrega)). Artes que uma exportação anterior da entrega gravou e esta não são removidas e listadas na caixa; arquivos seus nunca são tocados. Ela exporta os tamanhos do próprio brief, ou `formats` quando a chave `delivery` os nomeia, em PNG, ou `types` quando a chave os nomeia. Para um brief fora de entrega o botão fica cinza, e a dica dele diz por quê. O comando é **Entrega: exportar**, e pode ganhar uma tecla no `keybindings.json` como `delivery.export`; [`tyto render --delivery`](../command-line/deliveries.md#exportar-uma-entrega) faz o mesmo pela linha de comando.

A chave `delivery` diz onde e como, e cada parte dela é opcional:

```jsonc
{
  "delivery": {
    "parent": "entregas", // onde as entregas são criadas; a pasta aberta quando omitido
    "folders": ["assets", "editaveis"], // criadas dentro de cada entrega nova
    "brief": "editaveis", // a pasta em que o brief fica; "." é a própria entrega
    "exports": ".", // onde a arte dela é gravada
  },
}
```

Os valores mostrados para `folders`, `brief` e `exports` são os que valem quando a chave é omitida. `parent` é relativo à pasta aberta; os outros três são relativos à entrega e precisam ficar dentro dela. `exports` é onde a exportação de uma entrega grava as artes, e `formats` e `types` (listas de tamanhos e de tipos de arquivo) são o que ela exporta, quando escritos; omitidos, os tamanhos do próprio brief em PNG.

Um perfil de trabalho também pode ter um `delivery`, e uma campanha é um perfil de trabalho: o `delivery` da própria pasta substitui uma parte de cada vez, então uma pasta que escreve só `"exports": "final"` mantém as `folders` do perfil. O `parent` de um perfil continua relativo à pasta aberta. Uma entrega sempre fica dentro da pasta aberta, confiável ou não: um `parent` que leva para fora aparece como `W_PROJECT_PATH_OUTSIDE` e vale o anterior. Uma parte que não é aceita aparece em **Problemas** e vale a anterior, ou a mostrada acima.

## Ver os arquivos dela: o Explorador

Abrir uma pasta com **Arquivo ▸ Abrir pasta…** abre o **Explorador** na área esquerda, acima da fila. Ele lista os arquivos e pastas dela, pastas primeiro, e mostra o que há numa pasta quando você a abre. Um arquivo criado, renomeado ou apagado fora do Tyto aparece ou some sozinho, um instante depois.

- **Clique num brief** para abri-lo numa aba, ou selecione-o e aperte **Enter**. Um brief que já está aberto é a aba dele.
- **Clique num `.txt` ou num `.md`** para abri-lo numa aba também, como [um arquivo de texto](./text-files.md).
- **Clique numa pasta**, ou aperte **Direita** e **Esquerda**, para abri-la e fechá-la. **Cima**, **Baixo**, **Home** e **End** andam pela lista.
- **Clique numa imagem** — um `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` ou `.svg` — para vê-la na prévia, ou selecione-a e aperte **Enter**. O Explorador continua com o foco, então você pode seguir escolhendo; a aba da prévia leva o nome do arquivo, e [a prévia](./panels.md#uma-imagem-do-explorador) mostra o tamanho dela.
- **Qualquer outro arquivo** — um PDF, uma fonte, um `.json` — aparece na lista e não faz nada ao clique. O Tyto não abre arquivos com outros programas a partir do Explorador.
- Uma pasta com mais de 2.000 itens mostra os 2.000 primeiros e uma linha dizendo quantos faltam. A pasta `.git` não aparece.

Cada item tem um ícone do seu tipo: um brief, uma imagem, uma fonte, um arquivo JSON, um arquivo de texto, uma pasta de template e o `template.html`, o `template.ts` e o `manifest.yaml` dela, o `.tyto/project.json` do próprio projeto, e o `settings.json`, o `keybindings.json` e o `snippets.json` do app. Uma pasta chamada `assets`, e as pastas que o seu `.tyto/project.json` aponta como `assets`, `templates` ou `output`, ganham ícones próprios. Um arquivo para o qual o Tyto não tem ícone aparece como uma página em branco. As abas usam os mesmos ícones.

### Criar, renomear e excluir

Clique com o botão direito numa entrada para ter **Novo arquivo…**, **Nova pasta…**, **Renomear…** e **Excluir**; no espaço vazio abaixo da lista, só os dois itens de criar. Pelo teclado, **Shift+F10** ou a tecla **Menu** abre o mesmo menu embaixo da entrada selecionada; sem entrada selecionada, ele oferece só os dois itens de criar.

Com uma pasta aberta, o cabeçalho do Explorador tem três botões ao lado do **×**: **Novo arquivo…** e **Nova pasta…** abrem o mesmo campo do menu, no mesmo lugar, e **Recolher tudo** fecha todas as pastas abertas, em qualquer nível. Não há botão de atualizar: o Explorador lista de novo sozinho quando a pasta muda.

- **Novo arquivo…** e **Nova pasta…** abrem um campo na árvore: na pasta selecionada, na pasta do arquivo selecionado, ou no topo da pasta quando nada está selecionado (ou quando você clicou no espaço vazio). Digite o nome e aperte **Enter**. O nome fica exatamente como foi digitado, com ou sem extensão; um `.brief`, `.txt` ou `.md` novo abre numa aba, e qualquer outro arquivo só é criado.
- **Renomear…**, ou **F2** na entrada selecionada, transforma o nome dela no mesmo campo. Um brief aberto numa aba continua na aba, que mostra o nome novo; o texto que você não tinha salvado continua não salvo, e o próximo salvamento grava no nome novo.
- No campo, **Enter** ou clicar fora confirma e **Esc** cancela. Um nome que já existe, ou que nenhum arquivo pode ter, deixa o campo aberto com o seu texto e uma linha embaixo dizendo por quê.
- **Excluir**, ou a tecla **Delete** na entrada selecionada, sempre pergunta antes, e move o arquivo ou a pasta para a Lixeira do sistema, de onde dá para restaurar. O Tyto nunca apaga nada de vez. Se uma aba tem alterações não salvas de um arquivo ali, a pergunta avisa, e o texto continua na aba, que passa a não ter arquivo. Se a Lixeira recusar a entrada — alguns drives de rede não têm uma — nada é apagado e o Explorador avisa embaixo da entrada.

Isso funciona em qualquer pasta, confiável ou não: nada disso executa coisa alguma dela.

O botão do **Explorador** na barra de status, ao lado do da fila, mostra e esconde o painel, assim como **Mostrar ou esconder: Explorador** na barra de comandos. Quando o Tyto abre de novo com a pasta ainda aberta, o Explorador fica como você deixou: fechado, se você o fechou. Sem pasta aberta, ele diz _Nenhuma pasta aberta_ e oferece **Abrir pasta…**. Ele lista uma pasta em que você não confiou como qualquer outra: listar uma pasta não executa nada dela.

## O que um plugin lê da pasta

Um plugin instalado pode ter uma chave só dele em `plugins`, com o id do plugin como nome. É ali que a pasta diz a esse plugin o que este projeto usa — qual site ler, qual planilha preencher — e ela ganha das configurações do plugin no `settings.json`, que são suas e valem igual em toda pasta:

```jsonc
{
  "plugins": {
    "my-connector": { "site": "acme.example", "limit": 50 },
  },
}
```

O plugin lê a chave dele a cada pedido que recebe, então uma edição vale a partir do próximo pedido. **Ele nunca vê a chave de outro plugin**, e enquanto a pasta não tem confiança ele não vê nenhuma. O Tyto não confere o que tem dentro: é o plugin que avisa quando algo está errado. **Nunca ponha senha nem token aqui**: o arquivo é texto simples, que você copia e compartilha. Um plugin que precisa de um pede e guarda no armazenamento seguro do sistema.

Na linha de comando, `--section` define uma chave numa execução sem editar o arquivo, e funciona também numa pasta sem confiança — veja [Renderizar um brief](../command-line/render.md#outras-opcoes).

## Uma pasta em que você ainda não confiou

Toda pasta começa sem confiança. Uma pasta assim abre, mostra a prévia e exporta, mas toda pasta que o arquivo do projeto nomeia precisa estar dentro dela: um nome que leva para fora — `../shared`, um caminho absoluto, ou um atalho dentro da pasta que aponta para outro lugar — fica de fora. Cada um que fica de fora aparece no painel **Problemas** como `W_PROJECT_PATH_OUTSIDE`, com linha e coluna no `.tyto/project.json`. As seções de plugin dela também ficam retidas.

Quando algo fica de fora, uma faixa acima do editor avisa, com três botões: **Confiar nesta pasta** confia nela e aplica na hora o que tinha ficado de fora, **Mostrar problemas** abre o painel Problemas, e **Mostrar projeto** abre o painel Projeto (abaixo). Uma pasta cujos nomes ficam todos dentro dela nunca mostra a faixa.

## Perfis de trabalho

Um arquivo de projeto pode citar um **perfil de trabalho**: uma ficha de lugares que várias pastas compartilham, como as imagens, os templates, as fontes e a pasta de saída de uma vertical. `"profile": "saude"` cita um perfil guardado na sua pasta do Tyto, em `~/.tyto/profiles/saude/profile.json`; um caminho como `"profile": "team/saude.json"` cita um que a sua equipe compartilha. Os lugares do perfil vêm primeiro, e as chaves da própria pasta valem mais, uma chave de cada vez. [Renderizar um brief](../command-line/render.md#uma-ficha-para-varias-pastas-perfis-de-trabalho) mostra como escrever um.

Um perfil guardado na sua pasta do Tyto é confiável pelo lugar onde está e nunca pergunta nada. Um perfil citado pelo caminho recebe confiança por conta própria, nunca porque a pasta que o cita recebeu: até você confiar nele, as pastas dele precisam ficar dentro da pasta dele. Quando ele deixa algo de fora, a faixa acima do editor ganha uma linha só para ele, com **Confiar neste perfil**, e os problemas dele aparecem em **Problemas** com o arquivo do perfil na frente, como `team\saude.json:2:14`. Uma pasta confiável pode mostrar só a linha do perfil.

## Ver de onde veio cada lugar

**Pasta de trabalho: mostrar projeto**, na barra de comandos, abre o painel **Projeto** ao lado de Problemas. Ele tem uma linha para cada chave — `assets`, `templates`, `fonts` e `output` — com as pastas em vigor e de onde vieram: `perfil saude`, `esta pasta` ou `não definido`. Sem pasta aberta, ele diz _Nenhuma pasta aberta_. O botão **Mostrar projeto** da faixa também o abre, mas a faixa só aparece quando uma pasta ou um perfil sem confiança deixou algo de fora, então numa pasta em que você confia o caminho é o comando.

## Gerenciar confiança

**Pasta de trabalho: gerenciar confiança**, na barra de comandos, mostra a pasta aberta e se ela é confiável, com **Confiar** e **Retirar confiança**, e o perfil de trabalho que ela cita com os dois botões dele — nenhum para um perfil guardado na sua pasta do Tyto. Retirar a confiança vale na próxima vez que a pasta for aberta; até lá ela fica como está.

As pastas e os arquivos de perfil em que você confia ficam listados no `trust.json` da sua pasta do Tyto (`~/.tyto`). Na linha de comando, `tyto trust remove <pasta>` desfaz uma confiança; [Renderizar um brief](../command-line/render.md) tem o resto.
